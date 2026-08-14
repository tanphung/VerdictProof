"""Direct-mode tests for VerdictProof.

Direct mode is used for state transitions, validation, accounting, and mocked
web/LLM review. Full validator agreement should be covered by integration tests.
"""

import json
import sys

CONTRACT = "contracts/verdict_proof.py"
ONE_GEN = 10**18
POOL = 5 * 10**17
REWARD = 5 * 10**16
STAKE = 10**16
TX_HASH = "0x760c748dbd931513d4f741f8323d30e050df431f6fd1f439389a4b1f5d430cb7"
TX_URL = f"https://explorer-bradbury.genlayer.com/tx/{TX_HASH}"


def mock_receipt(direct_vm, sender, *, status=7, consensus_result=1, execution_result=1):
    sender_text = f"0x{sender.hex()}" if isinstance(sender, bytes) else str(sender)
    direct_vm.mock_web(
        r"^https://rpc-bradbury\.genlayer\.com$",
        {
            "method": "POST",
            "status": 200,
            "body": json.dumps(
                {
                    "jsonrpc": "2.0",
                    "result": {
                        "id": TX_HASH,
                        "sender": sender_text,
                        "recipient": "0x8b9f38f52c82a333c46f1061be242a9a880e6b0e",
                        "status": status,
                        "result": consensus_result,
                        "txExecutionResult": execution_result,
                        "txCallData": "6d6574686f647c6372656174655f63616d706169676e",
                    },
                    "id": 1,
                }
            ),
        },
    )


def mock_verified_evidence(direct_vm, sender, *, status=7, consensus_result=1, execution_result=1):
    mock_receipt(
        direct_vm,
        sender,
        status=status,
        consensus_result=consensus_result,
        execution_result=execution_result,
    )
    direct_vm.mock_web(r".*", {"status": 200, "body": "The public outcome page shows the completed campaign flow."})


def mock_hard_gate_feedback(direct_vm, *, feedback=18, insight=13, originality=9):
    direct_vm.mock_llm(
        r".*Score written product feedback.*",
        json.dumps(
            {
                "feedback_score": feedback,
                "insight_score": insight,
                "originality_score": originality,
                "feedback_reason": "The feedback identifies a concrete product issue.",
                "insight_reason": "The observation can guide a product improvement.",
                "originality_reason": "The feedback is specific to this workflow.",
                "improvement_recommendation": "Submit proof from the same tester wallet.",
                "risk_flags": "WALLET_MISMATCH",
            }
        ),
    )


def create_demo_campaign(contract, direct_vm):
    direct_vm.value = POOL
    cid = contract.create_campaign(
        "Test GenEscrow Demo",
        "https://example.com/genescrow-demo",
        "Create one escrow and explain the escrow creation UX.",
        "Transaction URL, app result URL, written feedback.",
        POOL,
        REWARD,
        STAKE,
        75,
    )
    direct_vm.value = 0
    return cid


def approve_demo_submission(contract, direct_vm, direct_alice):
    cid = create_demo_campaign(contract, direct_vm)
    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(
        cid,
        STAKE,
        TX_URL,
        "https://example.com/result/approved",
        (
            "I completed the campaign transaction and confirmed the wallet, stake, reward, proof, "
            "and dashboard result. The submission flow worked, but the final status should show "
            "the new campaign identifier beside the transaction receipt so the outcome is easier to verify."
        ),
    )
    direct_vm.value = 0
    mock_verified_evidence(direct_vm, contract.get_submission(sid)["tester"])
    direct_vm.mock_llm(
        r".*Rubric, total 100.*",
        json.dumps(
            {
                "score": 90,
                "transaction_success": True,
                "identity_match": True,
                "task_completed": True,
                "usage_valid": True,
                "feedback_quality": "HIGH",
                "proof_score": 38,
                "feedback_score": 23,
                "insight_score": 16,
                "originality_score": 13,
                "approved": True,
                "reason_summary": "Good signal.",
            }
        ),
    )
    contract.evaluate_submission(sid)
    return cid, sid


def reviews_equivalent(contract, leader, validator, minimum_score=75):
    module = sys.modules[type(contract).__module__]
    return module._reviews_equivalent(leader, validator, minimum_score)


def feedback_reviews_equivalent(contract, leader, validator):
    module = sys.modules[type(contract).__module__]
    return module._feedback_reviews_equivalent(leader, validator)


def review_candidate(**overrides):
    candidate = {
        "transaction_success": True,
        "identity_match": True,
        "task_completed": True,
        "usage_valid": True,
        "approved": True,
        "score": 88,
        "proof_score": 36,
        "feedback_score": 22,
        "insight_score": 17,
        "originality_score": 13,
        "feedback_quality": "HIGH",
    }
    candidate.update(overrides)
    return candidate


def test_create_campaign_stores_fields(direct_vm, direct_deploy, direct_owner):
    direct_vm.sender = direct_owner
    contract = direct_deploy(CONTRACT)

    cid = create_demo_campaign(contract, direct_vm)
    campaign = contract.get_campaign(cid)

    assert campaign["campaign_id"] == 1
    assert campaign["title"] == "Test GenEscrow Demo"
    assert campaign["reward_pool"] == str(POOL)
    assert campaign["reward_per_approved"] == str(REWARD)
    assert campaign["stake_required"] == str(STAKE)
    assert campaign["minimum_score"] == 75
    assert campaign["status"] == "OPEN"


def test_list_campaigns_empty_and_paginated(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)

    empty = contract.list_campaigns(0, 10)
    assert empty == {"count": 0, "total": 0, "campaigns": []}

    first = create_demo_campaign(contract, direct_vm)
    second = create_demo_campaign(contract, direct_vm)

    listed = contract.list_campaigns(0, 1)
    assert listed["count"] == 1
    assert listed["total"] == 2
    assert listed["campaigns"][0]["campaign_id"] == first

    next_page = contract.list_campaigns(1, 50)
    assert next_page["count"] == 1
    assert next_page["campaigns"][0]["campaign_id"] == second


def test_create_campaign_rejects_bad_values(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)

    direct_vm.value = 1
    with direct_vm.expect_revert("reward pool"):
        contract.create_campaign(
            "Tiny pool",
            "https://example.com",
            "Task",
            "Proof",
            1,
            REWARD,
            STAKE,
            75,
        )

    direct_vm.value = POOL
    with direct_vm.expect_revert("product_url"):
        contract.create_campaign(
            "Bad URL",
            "ftp://example.com",
            "Task",
            "Proof",
            POOL,
            REWARD,
            STAKE,
            75,
        )
    direct_vm.value = 0


def test_create_campaign_rejects_reward_above_pool_and_bad_score(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)

    direct_vm.value = POOL
    with direct_vm.expect_revert("invalid reward"):
        contract.create_campaign(
            "Reward too high",
            "https://example.com",
            "Task",
            "Proof",
            POOL,
            POOL + 1,
            STAKE,
            75,
        )

    with direct_vm.expect_revert("minimum_score"):
        contract.create_campaign(
            "Bad score",
            "https://example.com",
            "Task",
            "Proof",
            POOL,
            REWARD,
            STAKE,
            101,
        )
    direct_vm.value = 0


def test_payable_methods_reject_zero_message_value(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)

    direct_vm.value = 0
    with direct_vm.expect_revert("campaign pool value mismatch"):
        contract.create_campaign(
            "Unfunded Campaign",
            "https://example.com/unfunded",
            "Complete a live product test and submit concrete feedback.",
            "Transaction URL, app result URL, written feedback.",
            POOL,
            REWARD,
            STAKE,
            75,
        )

    cid = create_demo_campaign(contract, direct_vm)
    direct_vm.sender = direct_alice
    direct_vm.value = 0
    with direct_vm.expect_revert("tester stake value mismatch"):
        contract.submit_proof(
            cid,
            STAKE,
            TX_URL,
            "https://example.com/result/unfunded",
            "I completed the flow and found the confirmation copy unclear after wallet signing.",
        )


def test_observed_native_value_must_match_declared_amount(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)

    direct_vm.value = POOL - 1
    with direct_vm.expect_revert("campaign pool value mismatch"):
        contract.create_campaign(
            "Mismatch Campaign",
            "https://example.com/mismatch",
            "Complete a live product test.",
            "Transaction URL, app result URL, written feedback.",
            POOL,
            REWARD,
            STAKE,
            75,
        )

    cid = create_demo_campaign(contract, direct_vm)
    direct_vm.sender = direct_alice
    direct_vm.value = STAKE - 1
    with direct_vm.expect_revert("tester stake value mismatch"):
        contract.submit_proof(
            cid,
            STAKE,
            TX_URL,
            "https://example.com/result/mismatch",
            "I completed the flow and found one specific confirmation issue.",
        )
    direct_vm.value = 0


def test_submit_proof_creates_pending_submission(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)

    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(
        cid,
        STAKE,
        TX_URL,
        "https://example.com/genescrow-demo/result/1",
        "I created an escrow and found the confirmation state unclear after signing.",
    )
    direct_vm.value = 0

    submission = contract.get_submission(sid)
    assert submission["status"] == "PENDING"
    assert submission["stake_amount"] == str(STAKE)
    assert submission["score"] == 0
    assert contract.get_campaign(cid)["submission_count"] == 1


def test_submission_indexes_by_campaign_and_tester(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)

    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(
        cid,
        STAKE,
        TX_URL,
        "https://example.com/result/index",
        "I tested the app and found the confirmation copy unclear after signing.",
    )
    direct_vm.value = 0

    campaign_rows = contract.list_campaign_submissions(cid)
    tester = contract.get_submission(sid)["tester"]
    tester_rows = contract.list_tester_submissions(tester)

    assert campaign_rows["count"] == 1
    assert campaign_rows["submissions"][0]["submission_id"] == sid
    assert tester_rows["count"] == 1
    assert tester_rows["submissions"][0]["submission_id"] == sid


def test_submit_requires_exact_stake(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)

    direct_vm.sender = direct_alice
    direct_vm.value = 0
    with direct_vm.expect_revert("tester stake value mismatch"):
        contract.submit_proof(
            cid,
            STAKE - 1,
            TX_URL,
            "https://example.com/result",
            "Specific feedback with enough detail.",
        )
    direct_vm.value = 0


def test_submit_rejects_missing_campaign_and_bad_urls(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)

    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    with direct_vm.expect_revert("campaign not found"):
        contract.submit_proof(
            999,
            STAKE,
            TX_URL,
            "https://example.com/result",
            "Specific feedback with enough detail.",
        )

    with direct_vm.expect_revert("transaction_url"):
        contract.submit_proof(
            cid,
            STAKE,
            "not-a-url",
            "https://example.com/result",
            "Specific feedback with enough detail.",
        )

    with direct_vm.expect_revert("app_result_url"):
        contract.submit_proof(
            cid,
            STAKE,
            TX_URL,
            "ftp://example.com/result",
            "Specific feedback with enough detail.",
        )
    direct_vm.value = 0


def test_evaluate_approves_good_feedback(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)

    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(
        cid,
        STAKE,
        TX_URL,
        "https://example.com/genescrow-demo/result/good",
        "I created an escrow and submitted a test transaction. The wallet connection worked, but after signing, the UI did not clearly show whether the escrow was pending or confirmed.",
    )
    direct_vm.value = 0

    mock_verified_evidence(direct_vm, contract.get_submission(sid)["tester"])
    direct_vm.mock_llm(
        r".*Rubric, total 100.*",
        json.dumps(
            {
                "score": 87,
                "transaction_success": True,
                "identity_match": True,
                "task_completed": True,
                "usage_valid": True,
                "feedback_quality": "HIGH",
                "proof_score": 36,
                "feedback_score": 22,
                "insight_score": 16,
                "originality_score": 13,
                "approved": True,
                "reason_summary": "The tester completed the flow and gave specific confirmation UX feedback.",
                "transaction_analysis": "Receipt reached AGREE with successful execution.",
                "identity_analysis": "Receipt sender matches the tester wallet.",
                "task_analysis": "Escrow creation is visible in the transaction and outcome page.",
                "proof_reason": "Strong public transaction and outcome proof.",
                "feedback_reason": "Feedback names a specific post-signature status issue.",
                "insight_reason": "The recommendation is actionable for the product owner.",
                "originality_reason": "The observation is concrete and non-generic.",
                "settlement_explanation": "Stake and reward are unlocked for the approved tester.",
            }
        ),
    )

    reviewed = contract.evaluate_submission(sid)
    assert reviewed["status"] == "APPROVED"
    assert reviewed["score"] == 88
    assert reviewed["transaction_success"] is True
    assert reviewed["identity_match"] is True
    assert reviewed["task_completed"] is True
    assert reviewed["usage_valid"] is True
    assert reviewed["proof_score"] == 40
    assert reviewed["reward_amount"] == str(REWARD)
    assert reviewed["rubric_version"] == "VERDICTPROOF_V2_3"
    assert reviewed["validation_method"] == "INDEPENDENT_COMPARATIVE"
    assert reviewed["transaction_analysis"].startswith("Finalized receipt")
    assert "matches tester" in reviewed["identity_analysis"]
    assert reviewed["task_analysis"]
    assert reviewed["proof_reason"].startswith("Full proof credit")
    assert reviewed["feedback_reason"].startswith("Feedback names")
    assert reviewed["insight_reason"].startswith("The recommendation")
    assert reviewed["originality_reason"].startswith("The observation")
    assert "VALID_TOTAL_DELTA_12" in reviewed["consensus_checks"]
    assert reviewed["settlement_explanation"].startswith("Approved evidence")
    assert contract.get_campaign(cid)["reward_pool"] == str(POOL - REWARD)


def test_evaluate_requires_pending_submission(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    _, sid = approve_demo_submission(contract, direct_vm, direct_alice)

    with direct_vm.expect_revert("not pending"):
        contract.evaluate_submission(sid)

    with direct_vm.expect_revert("submission not found"):
        contract.evaluate_submission(999)


def test_evaluate_rejects_generic_feedback_and_slashes_stake(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)

    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(
        cid,
        STAKE,
        TX_URL,
        "https://example.com/genescrow-demo/result/bad",
        "Good app. Nice project. Very useful.",
    )
    direct_vm.value = 0

    mock_verified_evidence(direct_vm, contract.get_submission(sid)["tester"])
    direct_vm.mock_llm(
        r".*Rubric, total 100.*",
        json.dumps(
            {
                "score": 32,
                "transaction_success": False,
                "identity_match": False,
                "task_completed": False,
                "usage_valid": False,
                "feedback_quality": "LOW",
                "proof_score": 8,
                "feedback_score": 10,
                "insight_score": 8,
                "originality_score": 6,
                "approved": False,
                "reason_summary": "The feedback is generic and proof does not demonstrate usage.",
            }
        ),
    )

    reviewed = contract.evaluate_submission(sid)
    assert reviewed["status"] == "REJECTED"
    assert reviewed["score"] == 44
    assert reviewed["reward_amount"] == "0"
    assert contract.get_campaign(cid)["reward_pool"] == str(POOL + STAKE)


def test_evaluate_rejects_high_score_when_usage_proof_invalid(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)

    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(
        cid,
        STAKE,
        TX_URL,
        "https://example.com/result/high-score-invalid-proof",
        "The product copy is clear and I noticed the completion state should be more explicit.",
    )
    direct_vm.value = 0

    mock_verified_evidence(direct_vm, contract.get_submission(sid)["tester"])
    direct_vm.mock_llm(
        r".*Rubric, total 100.*",
        json.dumps(
            {
                "score": 82,
                "transaction_success": True,
                "identity_match": True,
                "task_completed": False,
                "usage_valid": False,
                "feedback_quality": "HIGH",
                "proof_score": 35,
                "feedback_score": 22,
                "insight_score": 15,
                "originality_score": 10,
                "approved": False,
                "reason_summary": "Feedback is useful, but the proof does not validate real product usage.",
            }
        ),
    )

    reviewed = contract.evaluate_submission(sid)
    assert reviewed["status"] == "REJECTED"
    assert reviewed["score"] == 65
    assert reviewed["proof_score"] == 20
    assert reviewed["transaction_success"] is True
    assert reviewed["identity_match"] is True
    assert reviewed["task_completed"] is False
    assert reviewed["usage_valid"] is False
    assert reviewed["reward_amount"] == "0"
    assert contract.get_campaign(cid)["reward_pool"] == str(POOL + STAKE)


def test_evaluate_uses_rpc_sender_instead_of_llm_identity_claim(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)

    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(
        cid,
        STAKE,
        TX_URL,
        "https://example.com/result/identity-mismatch",
        "I completed the campaign flow and found the transaction ownership explanation unclear.",
    )
    direct_vm.value = 0

    # Register no outcome-page mock: the hard-gate path must not render it.
    mock_receipt(direct_vm, direct_bob)
    mock_hard_gate_feedback(direct_vm)

    reviewed = contract.evaluate_submission(sid)
    assert reviewed["status"] == "REJECTED"
    assert reviewed["transaction_success"] is True
    assert reviewed["identity_match"] is False
    assert reviewed["task_completed"] is False
    assert reviewed["usage_valid"] is False
    assert reviewed["proof_score"] == 0
    assert reviewed["score"] == 41
    assert reviewed["validation_method"] == "INDEPENDENT_HARD_GATE_FEEDBACK"
    assert "IDENTITY_MISMATCH" in reviewed["risk_flags"]
    assert "FEEDBACK_DELTA_5" in reviewed["consensus_checks"]


def test_evaluate_keeps_pending_until_receipt_is_finalized(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)
    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(
        cid,
        STAKE,
        TX_URL,
        "https://example.com/result/accepted-not-finalized",
        "I completed the workflow and documented a specific confirmation-state issue for the product team.",
    )
    direct_vm.value = 0
    mock_receipt(direct_vm, direct_alice, status=5)

    with direct_vm.expect_revert("[TRANSIENT] evidence transaction is not finalized yet"):
        contract.evaluate_submission(sid)

    assert contract.get_submission(sid)["status"] == "PENDING"
    assert contract.get_campaign(cid)["reward_pool"] == str(POOL)


def test_finalized_execution_failure_uses_hard_gate_without_render(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)
    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(
        cid,
        STAKE,
        TX_URL,
        "https://example.com/result/must-not-render",
        "The failed transaction still exposed a confusing signing message that should explain the recovery action.",
    )
    direct_vm.value = 0
    mock_receipt(direct_vm, direct_alice, execution_result=0)
    mock_hard_gate_feedback(direct_vm, feedback=20, insight=14, originality=10)

    reviewed = contract.evaluate_submission(sid)

    assert reviewed["status"] == "REJECTED"
    assert reviewed["transaction_success"] is False
    assert reviewed["identity_match"] is True
    assert reviewed["task_completed"] is False
    assert reviewed["proof_score"] == 0
    assert reviewed["score"] == 45
    assert reviewed["validation_method"] == "INDEPENDENT_HARD_GATE_FEEDBACK"
    assert "TRANSACTION_FAILED" in reviewed["risk_flags"]
    assert reviewed["feedback_reason"].startswith("The feedback identifies")


def test_cross_origin_outcome_uses_objective_gate_without_render(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)
    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(
        cid,
        STAKE,
        TX_URL,
        "https://unrelated.example.org/not-product-evidence",
        "The transaction is finalized, but this outcome page is unrelated to the campaign product and must be rejected.",
    )
    direct_vm.value = 0
    mock_receipt(direct_vm, direct_alice)
    mock_hard_gate_feedback(direct_vm)

    reviewed = contract.evaluate_submission(sid)

    assert reviewed["status"] == "REJECTED"
    assert reviewed["transaction_success"] is True
    assert reviewed["identity_match"] is True
    assert reviewed["task_completed"] is False
    assert reviewed["proof_score"] == 0
    assert "OUTCOME_ORIGIN_MISMATCH" in reviewed["risk_flags"]
    assert reviewed["validation_method"] == "INDEPENDENT_HARD_GATE_FEEDBACK"


def test_hard_gate_validator_rejects_malicious_partial_scores(direct_deploy):
    contract = direct_deploy(CONTRACT)
    leader = review_candidate(
        transaction_success=False,
        identity_match=True,
        task_completed=False,
        usage_valid=False,
        approved=False,
        score=60,
        proof_score=0,
        feedback_score=25,
        insight_score=20,
        originality_score=15,
    )
    validator = review_candidate(
        transaction_success=False,
        identity_match=True,
        task_completed=False,
        usage_valid=False,
        approved=False,
        score=31,
        proof_score=0,
        feedback_score=14,
        insight_score=10,
        originality_score=7,
        feedback_quality="MEDIUM",
    )

    assert feedback_reviews_equivalent(contract, leader, validator) is False


def test_hard_gate_validator_accepts_scores_within_component_tolerance(direct_deploy):
    contract = direct_deploy(CONTRACT)
    leader = review_candidate(
        transaction_success=True,
        identity_match=False,
        task_completed=False,
        usage_valid=False,
        approved=False,
        score=39,
        proof_score=0,
        feedback_score=17,
        insight_score=13,
        originality_score=9,
        feedback_quality="MEDIUM",
    )
    validator = review_candidate(
        transaction_success=True,
        identity_match=False,
        task_completed=False,
        usage_valid=False,
        approved=False,
        score=31,
        proof_score=0,
        feedback_score=12,
        insight_score=9,
        originality_score=10,
        feedback_quality="LOW",
    )

    assert feedback_reviews_equivalent(contract, leader, validator) is True


def test_llm_error_does_not_rerun_leader_pipeline(direct_deploy):
    contract = direct_deploy(CONTRACT)
    module = sys.modules[type(contract).__module__]
    calls = []

    class LeaderError:
        message = "[LLM_ERROR] malformed response"

    def should_not_run():
        calls.append(True)
        return {}

    assert module._handle_leader_error(LeaderError(), should_not_run) is False
    assert calls == []


def test_evaluate_keeps_stake_pending_when_external_evidence_is_unavailable(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)

    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(
        cid,
        STAKE,
        TX_URL,
        "https://example.com/result/unrenderable",
        "I completed the flow and found the confirmation screen unclear after signing.",
    )
    direct_vm.value = 0

    with direct_vm.expect_revert("[TRANSIENT]"):
        contract.evaluate_submission(sid)

    assert contract.get_submission(sid)["status"] == "PENDING"
    assert contract.get_campaign(cid)["reward_pool"] == str(POOL)


def test_rpc_4xx_is_external_and_does_not_slash(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)
    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(
        cid,
        STAKE,
        TX_URL,
        "https://example.com/result/external",
        "I completed the campaign transaction and documented the wallet, proof, dashboard, and settlement behavior.",
    )
    direct_vm.value = 0
    direct_vm.mock_web(r"^https://rpc-bradbury\.genlayer\.com$", {"method": "POST", "status": 404, "body": "not found"})

    with direct_vm.expect_revert("[EXTERNAL] Bradbury RPC returned HTTP 404"):
        contract.evaluate_submission(sid)

    assert contract.get_submission(sid)["status"] == "PENDING"
    assert contract.get_campaign(cid)["reward_pool"] == str(POOL)


def test_rpc_5xx_is_transient_and_does_not_slash(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)
    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(
        cid,
        STAKE,
        TX_URL,
        "https://example.com/result/transient",
        "I completed the campaign transaction and documented the wallet, proof, dashboard, and settlement behavior.",
    )
    direct_vm.value = 0
    direct_vm.mock_web(r"^https://rpc-bradbury\.genlayer\.com$", {"method": "POST", "status": 503, "body": "unavailable"})

    with direct_vm.expect_revert("[TRANSIENT] Bradbury RPC temporarily unavailable"):
        contract.evaluate_submission(sid)

    assert contract.get_submission(sid)["status"] == "PENDING"
    assert contract.get_campaign(cid)["reward_pool"] == str(POOL)


def test_claim_reward_marks_submission_claimed(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    _, sid = approve_demo_submission(contract, direct_vm, direct_alice)

    result = contract.claim_reward(sid)
    assert result["status"] == "CLAIMED"
    assert result["paid_atto"] == str(STAKE + REWARD)
    assert contract.get_submission(sid)["status"] == "CLAIMED"


def test_claim_requires_tester_and_blocks_double_claim(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    _, sid = approve_demo_submission(contract, direct_vm, direct_alice)

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only tester"):
        contract.claim_reward(sid)

    direct_vm.sender = direct_alice
    contract.claim_reward(sid)

    with direct_vm.expect_revert("not approved"):
        contract.claim_reward(sid)


def test_rejected_submission_cannot_claim(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)

    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(
        cid,
        STAKE,
        TX_URL,
        "https://example.com/result/bad",
        "Nice app.",
    )
    direct_vm.value = 0
    mock_verified_evidence(direct_vm, contract.get_submission(sid)["tester"])
    direct_vm.mock_llm(
        r".*Rubric, total 100.*",
        json.dumps(
            {
                "score": 20,
                "transaction_success": False,
                "identity_match": False,
                "task_completed": False,
                "usage_valid": False,
                "feedback_quality": "LOW",
                "proof_score": 5,
                "feedback_score": 7,
                "insight_score": 5,
                "originality_score": 3,
                "approved": False,
                "reason_summary": "Low quality.",
            }
        ),
    )
    contract.evaluate_submission(sid)

    with direct_vm.expect_revert("not approved"):
        contract.claim_reward(sid)


def test_comparative_validator_rejects_malicious_score(direct_deploy):
    contract = direct_deploy(CONTRACT)
    leader = review_candidate(
        score=100,
        proof_score=40,
        feedback_score=25,
        insight_score=20,
        originality_score=15,
    )
    validator = review_candidate(
        score=76,
        proof_score=31,
        feedback_score=19,
        insight_score=15,
        originality_score=11,
    )

    assert reviews_equivalent(contract, leader, validator) is False


def test_comparative_validator_rejects_threshold_disagreement(direct_deploy):
    contract = direct_deploy(CONTRACT)
    leader = review_candidate(
        approved=True,
        score=76,
        proof_score=32,
        feedback_score=19,
        insight_score=14,
        originality_score=11,
    )
    validator = review_candidate(
        approved=False,
        score=72,
        proof_score=30,
        feedback_score=18,
        insight_score=14,
        originality_score=10,
        feedback_quality="MEDIUM",
    )

    assert reviews_equivalent(contract, leader, validator) is False


def test_comparative_validator_accepts_bounded_score_variation(direct_deploy):
    contract = direct_deploy(CONTRACT)
    leader = review_candidate(score=92, proof_score=40)
    validator = review_candidate(
        score=86,
        proof_score=40,
        feedback_score=20,
        insight_score=16,
        originality_score=10,
    )

    assert reviews_equivalent(contract, leader, validator) is True


def test_invalid_evidence_accepts_observed_bradbury_score_variance(direct_deploy):
    contract = direct_deploy(CONTRACT)
    leader = review_candidate(
        task_completed=False,
        usage_valid=False,
        approved=False,
        score=56,
        proof_score=20,
        feedback_score=20,
        insight_score=10,
        originality_score=6,
    )
    validator = review_candidate(
        task_completed=False,
        usage_valid=False,
        approved=False,
        score=51,
        proof_score=20,
        feedback_score=10,
        insight_score=12,
        originality_score=9,
    )

    assert reviews_equivalent(contract, leader, validator) is True


def test_invalid_evidence_rejects_unbounded_or_manipulated_score(direct_deploy):
    contract = direct_deploy(CONTRACT)
    leader = review_candidate(
        task_completed=False,
        usage_valid=False,
        approved=False,
        score=80,
        proof_score=20,
        feedback_score=25,
        insight_score=20,
        originality_score=15,
    )
    validator = review_candidate(
        task_completed=False,
        usage_valid=False,
        approved=False,
        score=20,
        proof_score=20,
        feedback_score=0,
        insight_score=0,
        originality_score=0,
    )

    assert reviews_equivalent(contract, leader, validator) is False


def test_comparative_validator_requires_exact_evidence_gates(direct_deploy):
    contract = direct_deploy(CONTRACT)
    leader = review_candidate()
    validator = review_candidate(identity_match=False, usage_valid=False, approved=False)

    assert reviews_equivalent(contract, leader, validator) is False


def test_close_campaign_refunds_remaining_pool(direct_vm, direct_deploy, direct_owner):
    direct_vm.sender = direct_owner
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)

    result = contract.close_campaign(cid)

    assert result == {
        "campaign_id": 1,
        "status": "CLOSED",
        "refunded_atto": str(POOL),
    }
    assert contract.get_campaign(cid)["status"] == "CLOSED"
    assert contract.get_campaign(cid)["reward_pool"] == "0"


def test_close_campaign_requires_owner_and_no_pending(
    direct_vm,
    direct_deploy,
    direct_owner,
    direct_alice,
):
    direct_vm.sender = direct_owner
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("only campaign owner"):
        contract.close_campaign(cid)

    direct_vm.value = STAKE
    contract.submit_proof(
        cid,
        STAKE,
        TX_URL,
        "https://example.com/result/pending",
        (
            "This campaign transaction proof and dashboard result need an independent validator "
            "review before the owner can close and withdraw the remaining reward pool."
        ),
    )
    direct_vm.value = 0
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("pending submissions"):
        contract.close_campaign(cid)


def test_close_campaign_blocks_double_close(direct_vm, direct_deploy, direct_owner):
    direct_vm.sender = direct_owner
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)
    contract.close_campaign(cid)

    with direct_vm.expect_revert("campaign is not open"):
        contract.close_campaign(cid)


def test_approved_claim_survives_campaign_close(
    direct_vm,
    direct_deploy,
    direct_owner,
    direct_alice,
):
    direct_vm.sender = direct_owner
    contract = direct_deploy(CONTRACT)
    cid, sid = approve_demo_submission(contract, direct_vm, direct_alice)

    direct_vm.sender = direct_owner
    close_result = contract.close_campaign(cid)
    assert int(close_result["refunded_atto"]) == POOL - REWARD

    direct_vm.sender = direct_alice
    claim_result = contract.claim_reward(sid)
    assert claim_result["status"] == "CLAIMED"
