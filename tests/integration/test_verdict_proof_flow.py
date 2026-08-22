"""Integration smoke tests for VerdictProof.

Run with:
    gltest tests/integration/ -v -s --network studionet
or:
    gltest tests/integration/ -v -s --network localnet
"""

import json
import time

from gltest import get_accounts, get_contract_factory
from gltest.assertions import tx_execution_succeeded

POOL = 5 * 10**17
REWARD = 5 * 10**16
STAKE = 10**16
APPROVED_TX_URL = "https://explorer-bradbury.genlayer.com/tx/0xcd649f4254ff0e87a1540b7249f19f24d57e9b1196fd11e588568024c4db233a"
SEMANTIC_TX_URL = "https://explorer-bradbury.genlayer.com/tx/0xca4d10514336f1b9e91cf458ce5365507272fccffcece4d94dccfbdc020c5b87"
IDENTITY_TX_URL = "https://explorer-bradbury.genlayer.com/tx/0xaa2d8caa5a0297bc76531fda7547aaf33379c73572135608be4624035fcfe483"
PRODUCT_URL = "https://verdictproof.vercel.app/"
APPROVED_OUTCOME_URL = "https://verdictproof.vercel.app/evidence/approved-campaign.html"
IDENTITY_OUTCOME_URL = "https://verdictproof.vercel.app/evidence/primary-campaign.html"
SEMANTIC_OUTCOME_URL = "https://verdictproof.vercel.app/evidence/semantic-mismatch.html"
EXPECTED_RECIPIENT = "0xf97993930ecb9e30efd77c0f2aaee29f4d34abed"
EXPECTED_METHOD = "submit_proof"
EXPECTED_TASK_IDENTIFIER = "https://explorer-bradbury.genlayer.com/tx/0x6b342ffe43704b1790d09afd92701363f9107f0f82797a153ad7f92382674f3a"


def consensus_return(receipt):
    assert str(receipt["status_name"]).upper().endswith("ACCEPTED")
    assert str(receipt["result_name"]).upper().endswith("AGREE")
    round_data = receipt.get("last_round") or {}
    votes = [str(vote).upper() for vote in round_data.get("validator_votes_name", [])]
    agreed = sum(vote.endswith("AGREE") and not vote.endswith("DISAGREE") for vote in votes)
    disagreed = sum(vote.endswith("DISAGREE") for vote in votes)
    assert len(votes) == 5
    assert agreed >= 3 and agreed > disagreed
    result = receipt["consensus_data"]["leader_receipt"][0]["result"]
    assert result["status"] == "return"
    return json.loads(result["payload"]["readable"])

def review_and_read(contract, submission_id):
    # Keep each consensus-heavy review in a fresh hosted-Studio rate-limit window.
    time.sleep(55)
    review = contract.evaluate_submission(args=[submission_id]).transact()
    assert tx_execution_succeeded(review)
    return consensus_return(review)


def test_full_semantic_and_hard_gate_consensus_flow():
    accounts = get_accounts()
    assert len(accounts) >= 2
    sponsor = accounts[0]
    approved_tester = accounts[1]
    assert approved_tester.address.lower() == "0x04d9beb3ae05ca01c77c7252d0b4fdbf4485b2e8"

    factory = get_contract_factory(contract_name="VerdictProof")
    contract = factory.deploy(args=[], account=sponsor)
    approved_contract = contract.connect(approved_tester)

    create = contract.create_campaign(
        args=[
            "Verify Public Product Evidence",
            PRODUCT_URL,
            "Submit proof for a funded VerdictProof campaign and verify that the referenced campaign evidence appears in the public outcome.",
            "A finalized submit_proof receipt containing the exact campaign transaction URL, a same-origin outcome that identifies the funded campaign, and specific feedback.",
            POOL,
            REWARD,
            STAKE,
            70,
            EXPECTED_RECIPIENT,
            EXPECTED_METHOD,
            EXPECTED_TASK_IDENTIFIER,
        ]
    ).transact(value=POOL)
    assert tx_execution_succeeded(create)

    identity_submit = contract.submit_proof(
        args=[
            1,
            STAKE,
            IDENTITY_TX_URL,
            IDENTITY_OUTCOME_URL,
            "The receipt belongs to another wallet, so it cannot prove that this tester completed the funded campaign flow.",
        ]
    ).transact(value=STAKE)
    assert tx_execution_succeeded(identity_submit)

    semantic_reject_submit = approved_contract.submit_proof(
        args=[
            1,
            STAKE,
            SEMANTIC_TX_URL,
            SEMANTIC_OUTCOME_URL,
            "The transaction is mine and finalized, but a generic homepage does not prove that the requested funded campaign appeared on the live board.",
        ]
    ).transact(value=STAKE)
    assert tx_execution_succeeded(semantic_reject_submit)

    approved_submit = approved_contract.submit_proof(
        args=[
            1,
            STAKE,
            APPROVED_TX_URL,
            APPROVED_OUTCOME_URL,
            "I created campaign #2 with a 0.10 GEN pool and verified the finalized receipt, live campaign evidence, wallet signing, and settlement information. Showing the campaign ID beside the transaction link would make receipt-to-state verification faster.",
        ]
    ).transact(value=STAKE)
    assert tx_execution_succeeded(approved_submit)

    identity = review_and_read(contract, 1)
    assert identity["status"] == "REJECTED"
    assert identity["transaction_success"] is True
    assert identity["identity_match"] is False
    assert identity["task_completed"] is False
    assert identity["validation_method"] == "INDEPENDENT_HARD_GATE_FEEDBACK"
    assert identity["proof_score"] == 0

    semantic_reject = review_and_read(contract, 2)
    assert semantic_reject["status"] == "REJECTED"
    assert semantic_reject["transaction_success"] is True
    assert semantic_reject["identity_match"] is True
    assert semantic_reject["task_completed"] is False
    assert semantic_reject["validation_method"] == "INDEPENDENT_COMPARATIVE"
    assert semantic_reject["proof_score"] == 20
    assert semantic_reject["recipient_match"] is True
    assert semantic_reject["method_match"] is True
    assert semantic_reject["task_identifier_match"] is True
    assert semantic_reject["reservation_status"] == "RELEASED"

    approved = review_and_read(contract, 3)
    assert approved["status"] == "APPROVED", json.dumps(approved, indent=2)
    assert approved["transaction_success"] is True
    assert approved["identity_match"] is True
    assert approved["task_completed"] is True
    assert approved["validation_method"] == "INDEPENDENT_COMPARATIVE"
    assert approved["proof_score"] == 40
    assert approved["recipient_match"] is True
    assert approved["method_match"] is True
    assert approved["task_identifier_match"] is True
    assert approved["reservation_status"] == "CONSUMED"

    for result in (identity, semantic_reject, approved):
        assert result["rubric_version"] == "VERDICTPROOF_V2_4_1"
        assert result["score"] == (
            result["proof_score"] + result["feedback_score"]
            + result["insight_score"] + result["originality_score"]
        )
        assert result["reason_summary"]
        assert result["evidence_summary"]
        assert result["transaction_analysis"]
        assert result["identity_analysis"]
        assert result["task_analysis"]
        assert result["proof_reason"]
        assert result["feedback_reason"]
        assert result["insight_reason"]
        assert result["originality_reason"]
        assert result["consensus_checks"]
        assert result["settlement_explanation"]
        assert result["reservation_status"] in ("CONSUMED", "RELEASED")
        assert result["binding_analysis"]
