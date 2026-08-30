"""V2.5 hosted-Studio consensus test.

This pre-deployment gate uses immutable GitHub evidence and an already-finalized
Bradbury receipt. The receipt deliberately fails two exact binding facts, so
the test proves that five protocol validators independently refetch the full
artifact and fail closed. A successful receipt cannot be created until the
user authorizes the separate Bradbury rollout; that approval flow belongs to
the post-deployment multi-wallet verifier.
"""

import json
import time

from gltest import get_accounts, get_contract_factory
from gltest.assertions import tx_execution_succeeded

POOL = 10**17
REWARD = 5 * 10**16
STAKE = 2 * 10**16
COMMIT = "6b56c2fcfb567a046a5166c81ebbe1ddf77fb540"
ARTIFACT_SHA256 = "21d8207a6770b0d1b93dd5fc85d79d7c2d93d63275106ce716e916c705c8b1ee"
ARTIFACT_LENGTH = 2906
TX_HASH = "0xcd649f4254ff0e87a1540b7249f19f24d57e9b1196fd11e588568024c4db233a"
TX_URL = f"https://explorer-bradbury.genlayer.com/tx/{TX_HASH}"
SOURCE_CONTRACT = "0xf97993930ecb9e30efd77c0f2aaee29f4d34abed"
TASK_VALUE = "https://explorer-bradbury.genlayer.com/tx/0x6b342ffe43704b1790d09afd92701363f9107f0f82797a153ad7f92382674f3a"
OUTCOME_VALUE = "https://verdictproof.vercel.app/evidence/approved-campaign.html"


def consensus_return(receipt):
    assert str(receipt["status_name"]).upper().endswith("ACCEPTED"), json.dumps(receipt, default=str, indent=2)
    assert str(receipt["result_name"]).upper().endswith("AGREE")
    votes = [str(vote).upper() for vote in (receipt.get("last_round") or {}).get("validator_votes_name", [])]
    agreed = sum(vote.endswith("AGREE") and not vote.endswith("DISAGREE") for vote in votes)
    disagreed = sum(vote.endswith("DISAGREE") for vote in votes)
    assert len(votes) == 5
    assert agreed >= 3 and agreed > disagreed
    result = receipt["consensus_data"]["leader_receipt"][0]["result"]
    assert result["status"] == "return"
    return json.loads(result["payload"]["readable"])


def test_full_artifact_and_exact_binding_consensus():
    accounts = get_accounts()
    assert len(accounts) >= 2
    sponsor, tester = accounts[:2]
    assert tester.address.lower() == "0x04d9beb3ae05ca01c77c7252d0b4fdbf4485b2e8"

    contract = get_contract_factory(contract_name="VerdictProof").deploy(args=[], account=sponsor)
    tester_contract = contract.connect(tester)
    policy = {
        "schema": "VERDICTPROOF_POLICY_V1",
        "submission_deadline": int(time.time()) + 7 * 86400,
        "obligations": [
            {"id": "OBL-001", "text": "Document the mandatory deployment quality-gate order."},
            {"id": "OBL-002", "text": "Document public verification artifacts and secret scanning."},
        ],
        "artifact": {
            "provider": "GITHUB", "auth_mode": "GITHUB_API", "owner": "tanphung",
            "repository": "VerdictProof", "path": "deploy/README.md", "content_type": "text/markdown",
        },
        "receipt": {
            "source_contract": SOURCE_CONTRACT,
            "method": "submit_proof",
            "task_identifier": {"selector": "args.2", "value": TASK_VALUE},
            "deal": {"selector": "args.3", "value": OUTCOME_VALUE},
            # The historic transaction has no typed recipient or released
            # arguments. These exact checks must therefore fail closed.
            "recipient": {"selector": "args.4", "value": tester.address},
            "amount_atto": {"selector": "args.1", "value": str(STAKE)},
            "kind": {"selector": "args.3", "value": OUTCOME_VALUE},
            "released": {"selector": "args.0", "value": True},
        },
    }

    create = contract.create_campaign(args=[
        "Full-assurance deployment evidence",
        "https://github.com/tanphung/VerdictProof",
        "Review the complete immutable deploy guide against every accepted obligation.",
        "Authenticated GitHub artifact, complete chunk coverage, and exact Bradbury receipt facts.",
        POOL, REWARD, STAKE, 70, json.dumps(policy, separators=(",", ":")),
    ]).transact(value=POOL)
    assert tx_execution_succeeded(create)

    submit = tester_contract.submit_proof(args=[
        1, STAKE, TX_URL, COMMIT, ARTIFACT_SHA256, ARTIFACT_LENGTH,
        "The immutable guide documents quality gates and public verification controls.",
    ]).transact(value=STAKE)
    assert tx_execution_succeeded(submit)

    time.sleep(55)
    review_receipt = contract.evaluate_submission(args=[1]).transact()
    assert tx_execution_succeeded(review_receipt)
    result = consensus_return(review_receipt)

    assert result["rubric_version"] == "VERDICTPROOF_V2_5_FULL_ASSURANCE"
    assert result["validation_method"] == "INDEPENDENT_FULL_ARTIFACT_COMPARATIVE"
    assert result["status"] == "REJECTED"
    assert result["reservation_status"] == "RELEASED"
    assert result["provenance_manifest"]["commit_sha"] == COMMIT
    assert result["artifact_sha256"] == ARTIFACT_SHA256
    assert result["artifact_byte_length"] == ARTIFACT_LENGTH
    assert result["reviewed_chunks"] == list(range(result["total_chunks"]))
    assert len(result["chunk_digests"]) == result["total_chunks"]
    assert [item["obligation_id"] for item in result["obligation_assessments"]] == ["OBL-001", "OBL-002"]
    assert result["receipt_checks"]["finalized_success"] is True
    assert result["receipt_checks"]["sender_match"] is True
    assert result["receipt_checks"]["source_contract_match"] is True
    assert result["receipt_checks"]["method_match"] is True
    assert result["receipt_checks"]["recipient_match"] is False
    assert result["receipt_checks"]["released_match"] is False
    assert result["receipt_checks"]["all_match"] is False
    assert result["settlement_record"]["kind"] == "REJECTION_SLASH"
