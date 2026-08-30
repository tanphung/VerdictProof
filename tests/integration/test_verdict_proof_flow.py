"""Full-artifact approval against a finalized Bradbury escrow receipt."""

import json
import time

from gltest import get_accounts, get_contract_factory
from gltest.assertions import tx_execution_succeeded


POOL = 10**17
REWARD = 5 * 10**16
STAKE = 2 * 10**16
COMMIT = "2facfe26e0d0e25b34d63b3a5b5b55a5a34c9c01"
ARTIFACT_SHA256 = "38c7fcd494d3fa0aea4957996e168dddc7803878ca28ac63345c06e26bfa5987"
ARTIFACT_LENGTH = 807
ESCROW = "0x465f33065C84A3C598E85801608d45F454D69bdF"
RELEASE_TX = "0x52ab9f5256ce034ad2ba7c132f783ec1fcf4ee1d9eb89ed120efcd182790c738"
TASK = "VP25-STUDIONET-2facfe26"
DEAL = "DEAL-STUDIONET-2facfe26"
RECIPIENT = "0xAE6b929dDDcDEb2207d6B7E1cFc9A74Ea580E579"
AMOUNT = 10**15


def consensus_return(receipt):
    assert str(receipt["status_name"]).upper().endswith("ACCEPTED"), json.dumps(receipt, default=str)
    assert str(receipt["result_name"]).upper().endswith("AGREE")
    result = receipt["consensus_data"]["leader_receipt"][0]["result"]
    assert result["status"] == "return"
    return json.loads(result["payload"]["readable"])


def test_full_artifact_approval_from_finalized_bradbury_receipt():
    sponsor, tester = get_accounts()[:2]
    contract = get_contract_factory(contract_name="VerdictProof").deploy(args=[], account=sponsor)
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
            "repository": "VerdictProof", "path": "evidence/v2.5/approved.md", "content_type": "text/markdown",
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
        "The finalized release proves exact task, deal, recipient, amount, kind and released state. "
        "The immutable artifact covers every byte with ordered chunk digests, and reservation accounting "
        "is explicit before review and claim.",
    ]).transact(value=STAKE)
    assert tx_execution_succeeded(submit)
    time.sleep(55)
    review = contract.evaluate_submission(args=[1]).transact()
    assert tx_execution_succeeded(review)
    result = consensus_return(review)
    assert result["rubric_version"] == "VERDICTPROOF_V2_5_FULL_ASSURANCE"
    assert result["validation_method"] == "INDEPENDENT_FULL_ARTIFACT_COMPARATIVE"
    assert result["status"] == "APPROVED"
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
