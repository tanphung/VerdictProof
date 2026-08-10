"""Integration smoke tests for VerdictProof.

Run with:
    gltest tests/integration/ -v -s --network studionet
or:
    gltest tests/integration/ -v -s --network localnet
"""

import time

from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded

POOL = 5 * 10**17
REWARD = 5 * 10**16
STAKE = 10**16
BRADBURY_TX_URL = "https://explorer-bradbury.genlayer.com/tx/0x760c748dbd931513d4f741f8323d30e050df431f6fd1f439389a4b1f5d430cb7"

def test_ai_review_reaches_consensus_on_public_evidence():
    factory = get_contract_factory(contract_name="VerdictProof")
    contract = factory.deploy(args=[])

    create = contract.create_campaign(
        args=[
            "Verify Public Product Evidence",
            "https://verdictproof.vercel.app/",
            "Inspect the public app and submit evidence of one completed product flow.",
            "A public transaction or evidence URL, a public result page, and specific feedback.",
            POOL,
            REWARD,
            STAKE,
            70,
        ]
    ).transact(value=POOL)
    assert tx_execution_succeeded(create)

    submit = contract.submit_proof(
        args=[
            1,
            STAKE,
            BRADBURY_TX_URL,
            "https://www.iana.org/help/example-domains",
            "The submitted pages do not prove a completed VerdictProof campaign flow, so this evidence should be rejected.",
        ]
    ).transact(value=STAKE)
    assert tx_execution_succeeded(submit)

    # Hosted Studio currently caps a client at 30 RPC calls per rolling minute.
    # Let deploy/create/submit polling leave that window before the consensus-heavy review.
    time.sleep(55)
    review = contract.evaluate_submission(args=[1]).transact()
    assert tx_execution_succeeded(review)

    result = contract.get_submission(args=[1]).call()
    assert result["status"] == "REJECTED"
    assert result["reason_summary"]
    assert result["evidence_summary"]
    assert result["transaction_success"] is True
    assert isinstance(result["identity_match"], bool)
    assert isinstance(result["task_completed"], bool)
    assert result["usage_valid"] == (
        result["transaction_success"]
        and result["identity_match"]
        and result["task_completed"]
    )
    assert result["score"] == (
        result["proof_score"]
        + result["feedback_score"]
        + result["insight_score"]
        + result["originality_score"]
    )
    assert result["task_completed"] is False
    assert result["usage_valid"] is False
    assert result["approved"] is False
    assert result["rubric_version"] == "VERDICTPROOF_V2_1"
    assert result["validation_method"] == "INDEPENDENT_COMPARATIVE"
    assert result["transaction_analysis"]
    assert result["identity_analysis"]
    assert result["task_analysis"]
    assert result["proof_reason"]
    assert result["feedback_reason"]
    assert result["insight_reason"]
    assert result["originality_reason"]
    assert result["consensus_checks"]
    assert result["settlement_explanation"]
