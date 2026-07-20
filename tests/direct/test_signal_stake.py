"""Direct-mode tests for VerdictProof.

Direct mode is used for state transitions, validation, accounting, and mocked
web/LLM review. Full validator agreement should be covered by integration tests.
"""

import json

CONTRACT = "contracts/signal_stake.py"
ONE_GEN = 10**18
POOL = 5 * 10**17
REWARD = 5 * 10**16
STAKE = 10**16


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
        "https://example.com/tx/0xapproved",
        "https://example.com/result/approved",
        "I completed the flow and found the post-signature status messaging unclear.",
    )
    direct_vm.value = 0
    direct_vm.mock_web(r".*", {"status": 200, "body": "Proof confirms usage."})
    direct_vm.mock_llm(
        r".*Rubric, total 100.*",
        json.dumps(
            {
                "score": 90,
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
            "https://example.com/tx/0xunfunded",
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
            "https://example.com/tx/0xmismatch",
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
        "https://example.com/tx/0x123",
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
        "https://example.com/tx/0xindex",
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
            "https://example.com/tx/0x123",
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
            "https://example.com/tx/0xmissing",
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
            "https://example.com/tx/0xok",
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
        "https://example.com/tx/0xgood",
        "https://example.com/genescrow-demo/result/good",
        "I created an escrow and submitted a test transaction. The wallet connection worked, but after signing, the UI did not clearly show whether the escrow was pending or confirmed.",
    )
    direct_vm.value = 0

    direct_vm.mock_web(r".*", {"status": 200, "body": "Rendered proof confirms an escrow creation flow."})
    direct_vm.mock_llm(
        r".*Rubric, total 100.*",
        json.dumps(
            {
                "score": 87,
                "usage_valid": True,
                "feedback_quality": "HIGH",
                "proof_score": 36,
                "feedback_score": 22,
                "insight_score": 16,
                "originality_score": 13,
                "approved": True,
                "reason_summary": "The tester completed the flow and gave specific confirmation UX feedback.",
            }
        ),
    )

    reviewed = contract.evaluate_submission(sid)
    assert reviewed["status"] == "APPROVED"
    assert reviewed["score"] == 87
    assert reviewed["reward_amount"] == str(REWARD)
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
        "https://example.com/tx/0xbad",
        "https://example.com/genescrow-demo/result/bad",
        "Good app. Nice project. Very useful.",
    )
    direct_vm.value = 0

    direct_vm.mock_web(r".*", {"status": 200, "body": "Proof page is generic and does not show a completed task."})
    direct_vm.mock_llm(
        r".*Rubric, total 100.*",
        json.dumps(
            {
                "score": 32,
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
    assert reviewed["score"] == 32
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
        "https://example.com/tx/high-score-invalid-proof",
        "https://example.com/result/high-score-invalid-proof",
        "The product copy is clear and I noticed the completion state should be more explicit.",
    )
    direct_vm.value = 0

    direct_vm.mock_web(r".*", {"status": 200, "body": "Rendered product text, but proof does not show a completed user flow."})
    direct_vm.mock_llm(
        r".*Rubric, total 100.*",
        json.dumps(
            {
                "score": 82,
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
    assert reviewed["score"] == 82
    assert reviewed["reward_amount"] == "0"
    assert contract.get_campaign(cid)["reward_pool"] == str(POOL + STAKE)


def test_evaluate_rejects_unrenderable_proof_without_reverting(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_demo_campaign(contract, direct_vm)

    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(
        cid,
        STAKE,
        "https://example.com/tx/unrenderable",
        "https://example.com/result/unrenderable",
        "I completed the flow and found the confirmation screen unclear after signing.",
    )
    direct_vm.value = 0

    reviewed = contract.evaluate_submission(sid)

    assert reviewed["status"] == "REJECTED"
    assert reviewed["score"] == 0
    assert reviewed["reward_amount"] == "0"
    assert "could not be rendered" in reviewed["reason_summary"]
    assert contract.get_campaign(cid)["reward_pool"] == str(POOL + STAKE)


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
        "https://example.com/tx/0xbad",
        "https://example.com/result/bad",
        "Nice app.",
    )
    direct_vm.value = 0
    direct_vm.mock_web(r".*", {"status": 200, "body": "Weak proof."})
    direct_vm.mock_llm(
        r".*Rubric, total 100.*",
        json.dumps(
            {
                "score": 20,
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
