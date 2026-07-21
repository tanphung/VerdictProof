"""Integration smoke tests for VerdictProof.

Run with:
    gltest tests/integration/ -v -s --network studionet
or:
    gltest tests/integration/ -v -s --network localnet
"""

from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded, tx_execution_failed

POOL = 5 * 10**17
REWARD = 5 * 10**16
STAKE = 10**16


def test_create_campaign_and_reject_bad_submit():
    factory = get_contract_factory(contract_name="VerdictProof")
    contract = factory.deploy(args=[])

    tx = contract.create_campaign(
        args=[
            "Test GenEscrow Demo",
            "https://example.com/genescrow-demo",
            "Create one escrow and explain the escrow creation UX.",
            "Transaction URL, app result URL, written feedback.",
            POOL,
            REWARD,
            STAKE,
            75,
        ]
    ).transact(value=POOL)
    assert tx_execution_succeeded(tx)

    campaigns = contract.list_campaigns(args=[0, 10]).call()
    assert campaigns["total"] == 1
    assert campaigns["campaigns"][0]["title"] == "Test GenEscrow Demo"

    bad = contract.submit_proof(
        args=[
            1,
            STAKE,
            "not-a-url",
            "https://example.com/result",
            "Good app.",
        ]
    ).transact(value=STAKE)
    assert tx_execution_failed(bad)


def test_submit_proof_success_and_exact_stake_required():
    factory = get_contract_factory(contract_name="VerdictProof")
    contract = factory.deploy(args=[])

    create = contract.create_campaign(
        args=[
            "Audit a Wallet Confirmation Flow",
            "https://example.com/wallet-flow",
            "Complete the wallet confirmation flow and report UX friction.",
            "Transaction URL, result URL, written feedback.",
            POOL,
            REWARD,
            STAKE,
            75,
        ]
    ).transact(value=POOL)
    assert tx_execution_succeeded(create)

    wrong_stake = contract.submit_proof(
        args=[
            1,
            STAKE - 1,
            "https://example.com/tx/0xwrongstake",
            "https://example.com/result/wrongstake",
            "I completed the flow and found one specific confirmation issue.",
        ]
    ).transact(value=STAKE - 1)
    assert tx_execution_failed(wrong_stake)

    submit = contract.submit_proof(
        args=[
            1,
            STAKE,
            "https://example.com/tx/0xsuccess",
            "https://example.com/result/success",
            "I completed the flow and found the confirmation screen unclear after signing.",
        ]
    ).transact(value=STAKE)
    assert tx_execution_succeeded(submit)

    submissions = contract.list_campaign_submissions(args=[1]).call()
    assert submissions["count"] == 1
    assert submissions["submissions"][0]["status"] == "PENDING"


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
            "https://example.com/",
            "https://www.iana.org/help/example-domains",
            "The submitted pages do not prove a completed VerdictProof campaign flow, so this evidence should be rejected.",
        ]
    ).transact(value=STAKE)
    assert tx_execution_succeeded(submit)

    review = contract.evaluate_submission(args=[1]).transact()
    assert tx_execution_succeeded(review)

    result = contract.get_submission(args=[1]).call()
    assert result["status"] in ("APPROVED", "REJECTED")
    assert result["status"] != "PENDING"
    assert result["reason_summary"]
    assert result["evidence_summary"]
    assert isinstance(result["transaction_success"], bool)
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
