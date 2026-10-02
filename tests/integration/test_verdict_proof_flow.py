"""Full-artifact approval against a finalized Bradbury escrow receipt."""

import json
import time

from gltest import get_accounts, get_contract_factory
from gltest.assertions import tx_execution_succeeded


POOL = 10**17
REWARD = POOL
STAKE = 2 * 10**16
COMMIT = "436c4f03cb2d35d2a2351fc69143b8365402e8f5"
ARTIFACT_SHA256 = "0b81796be04c967353a9fce0ce58b12f9c4789556df4ca9edb912fb8a9c6ce6f"
ARTIFACT_LENGTH = 2084
ESCROW = "0x465f33065C84A3C598E85801608d45F454D69bdF"
RELEASE_TX = "0x52ab9f5256ce034ad2ba7c132f783ec1fcf4ee1d9eb89ed120efcd182790c738"
TASK = "VP25-STUDIONET-2facfe26"
DEAL = "DEAL-STUDIONET-2facfe26"
RECIPIENT = "0xAE6b929dDDcDEb2207d6B7E1cFc9A74Ea580E579"
AMOUNT = 10**15


def consensus_return(receipt):
    diagnostic = {
        "hash": receipt.get("hash"), "status": receipt.get("status_name"),
        "result": receipt.get("result_name"),
        "votes": receipt.get("last_round", {}).get("validator_votes_name", []),
    }
    assert str(receipt["status_name"]).upper() in ("ACCEPTED", "FINALIZED"), json.dumps(diagnostic)
    assert str(receipt["result_name"]).upper().split(".")[-1] in ("AGREE", "MAJORITY_AGREE")
    result = receipt["consensus_data"]["leader_receipt"][0]["result"]
    assert result["status"] == "return"
    return json.loads(result["payload"]["readable"])


def test_full_artifact_approval_from_finalized_bradbury_receipt():
    sponsor, tester = get_accounts()[:2]
    helpers = [get_contract_factory(contract_name=name).deploy(args=[], account=sponsor)
               for name in ("ProofProvenance", "ProofReceipt", "ProofReview")]
    contract = get_contract_factory(contract_name="VerdictProof").deploy(
        args=[helper.address for helper in helpers], account=sponsor)
    policy = {
        "schema": "VERDICTPROOF_POLICY_V1",
        "submission_deadline": int(time.time()) + 7 * 86400,
        "obligations": [
            {"id": "OBL-001", "text": "Document exact escrow task, deal, recipient, amount, kind, and released state."},
            {"id": "OBL-002", "text": "Document complete immutable artifact verification and chunk coverage."},
            {"id": "OBL-003", "text": "Document reward reservation and settlement accounting."},
        ],
        "artifact": {
            "provider": "GITHUB", "auth_mode": "GITHUB_API", "owner": "tanphung",
            "repository": "VerdictProof", "path": "evidence/v2.5/steward-approved.md", "content_type": "text/markdown",
        },
        "receipt": {
            "source_contract": ESCROW, "method": "release",
            "task_identifier": {"selector": "args.0", "value": TASK},
            "deal": {"selector": "args.1", "value": DEAL},
            "recipient": {"selector": "args.2", "value": RECIPIENT},
            "amount_atto": {"selector": "args.3", "value": str(AMOUNT)},
            "kind": {"selector": "args.4", "value": "RELEASE"},
            "released": {"selector": "args.5", "value": True},
        },
    }
    create = contract.create_campaign(args=[
        "Full-artifact approval", "https://verdictproof.vercel.app/",
        "Complete the funded escrow release and document every accepted obligation.",
        "Authenticated GitHub artifact, complete chunk coverage, and exact Bradbury receipt facts.",
        POOL, REWARD, STAKE, 70, json.dumps(policy, separators=(",", ":")),
    ]).transact(value=POOL)
    assert tx_execution_succeeded(create)
    submit = contract.connect(tester).submit_proof(args=[
        1, STAKE, f"https://explorer-bradbury.genlayer.com/tx/{RELEASE_TX}", COMMIT,
        ARTIFACT_SHA256, ARTIFACT_LENGTH,
        "OBL-001 documents both the escrow destination and a different beneficiary. "
        "Label these addresses separately in an expected/actual table beside each failed gate; "
        "one generic recipient label makes a correct release look mismatched. "
        "OBL-002 describes both a full SHA-256 and ordered chunk digests. Show the full digest plus reviewed/total "
        "chunks in the report: a matching first chunk would hide a contradictory tail. "
        "OBL-003 says approval consumes a reservation independently of the available pool. Display available "
        "and reserved rewards separately and warn before signing when no slot remains. Otherwise a zero "
        "available balance misleadingly looks insolvent even when every pending reward is funded. "
        "Together these changes expose attribution, content integrity and payout capacity as three separately "
        "inspectable facts instead of one ambiguous success badge.",
    ]).transact(value=STAKE)
    assert tx_execution_succeeded(submit)
    time.sleep(55)
    campaign = contract.get_campaign(args=[1]).call()
    assert campaign["reward_pool"] == "0"
    assert campaign["reserved_reward_pool"] == str(POOL)
    review = contract.evaluate_submission(args=[1]).transact()
    assert tx_execution_succeeded(review)
    result = consensus_return(review)
    assert result["rubric_version"] == "VERDICTPROOF_V2_6_STEWARD_REMEDIATION"
    assert result["validation_method"] == "INDEPENDENT_FULL_ARTIFACT_COMPARATIVE"
    assert result["status"] == "APPROVED", json.dumps({
        "hash": review.get("hash"), "score": result.get("score"),
        "reason": result.get("reason_summary"), "assessments": result.get("obligation_assessments"),
    })
    assert result["reservation_status"] == "CONSUMED"
    assert result["provenance_manifest"]["commit_sha"] == COMMIT
    assert result["artifact_sha256"] == ARTIFACT_SHA256
    assert result["artifact_byte_length"] == ARTIFACT_LENGTH
    assert result["reviewed_chunks"] == list(range(result["total_chunks"]))
    assert len(result["chunk_digests"]) == result["total_chunks"]
    assert [item["obligation_id"] for item in result["obligation_assessments"]] == ["OBL-001", "OBL-002", "OBL-003"]
    assert all(item["verdict"] == "SATISFIED" for item in result["obligation_assessments"])
    assert result["receipt_checks"]["finalized_success"] is True
    assert result["receipt_checks"]["sender_match"] is True
    assert result["receipt_checks"]["source_contract_match"] is True
    assert result["receipt_checks"]["method_match"] is True
    assert result["receipt_checks"]["all_match"] is True

    close = contract.close_campaign(args=[1]).transact()
    assert tx_execution_succeeded(close)
    closed = consensus_return(close)
    assert closed["amount_atto"] == "0"
    claim = contract.connect(tester).claim_reward(args=[1]).transact()
    assert tx_execution_succeeded(claim)
    claimed = consensus_return(claim)
    assert claimed["paid_atto"] == str(STAKE + POOL)
    assert claimed["status"] == "CLAIMED"
