"""V2.5 direct and adversarial tests.

Direct mode executes the leader path. Comparator behavior is tested through the
module helpers; full protocol-selected validator execution remains an
integration-test responsibility.
"""

import base64
import copy
import hashlib
import json
import sys
from datetime import datetime, timezone

import pytest

CONTRACT = "contracts/verdict_proof.py"
NOW_ISO = "2026-08-30T00:00:00Z"
NOW = int(datetime(2026, 8, 30, tzinfo=timezone.utc).timestamp())
DEADLINE = NOW + 2 * 86400
POOL = 5 * 10**17
REWARD = 5 * 10**16
STAKE = 10**16
SOURCE = "0x8b9f38f52c82a333c46f1061be242a9a880e6b0e"
BENEFICIARY = "0x1111111111111111111111111111111111111111"
TX_HASH = "0x760c748dbd931513d4f741f8323d30e050df431f6fd1f439389a4b1f5d430cb7"
TX_HASH_2 = "0x860c748dbd931513d4f741f8323d30e050df431f6fd1f439389a4b1f5d430cb8"
TX_URL = f"https://explorer-bradbury.genlayer.com/tx/{TX_HASH}"
COMMIT = "a" * 40
COMMIT_2 = "b" * 40
BLOB = "c" * 40
ARTIFACT = (
    "Campaign TASK-001 completed DEAL-001 for the configured beneficiary.\n"
    + "Evidence confirms the release workflow and public result. " * 24
)


def policy(**overrides):
    value = {
        "schema": "VERDICTPROOF_POLICY_V1",
        "submission_deadline": DEADLINE,
        "obligations": [
            {"id": "OBL-001", "text": "Complete the configured release transaction."},
            {"id": "OBL-002", "text": "Document the resulting campaign state."},
        ],
        "artifact": {
            "provider": "GITHUB",
            "auth_mode": "GITHUB_API",
            "owner": "tanphung",
            "repository": "VerdictProof",
            "path": "evidence/result.md",
            "content_type": "text/markdown",
        },
        "receipt": {
            "source_contract": SOURCE,
            "method": "release",
            "task_identifier": {"selector": "kwargs.task_identifier", "value": "TASK-001"},
            "deal": {"selector": "kwargs.deal_id", "value": "DEAL-001"},
            "recipient": {"selector": "kwargs.recipient", "value": BENEFICIARY},
            "amount_atto": {"selector": "kwargs.amount_atto", "value": str(REWARD)},
            "kind": {"selector": "kwargs.kind", "value": "RELEASE"},
            "released": {"selector": "kwargs.released", "value": True},
        },
    }
    value.update(overrides)
    return value


def mock_repo(direct_vm, *, owner="tanphung", repository="VerdictProof", status=200):
    direct_vm.mock_web(
        r"^https://api\.github\.com/repos/tanphung/VerdictProof$",
        {
            "status": status,
            "body": json.dumps(
                {
                    "id": 12345,
                    "node_id": "R_repo_node",
                    "name": repository,
                    "full_name": f"{owner}/{repository}",
                    "owner": {"login": owner, "id": 6789},
                }
            ),
        },
    )


def mock_artifact(direct_vm, text=ARTIFACT, *, commit=COMMIT, blob=BLOB, status=200, encoding="base64", api_size=None):
    data = text if isinstance(text, bytes) else text.encode("utf-8")
    direct_vm.mock_web(
        rf"^https://api\.github\.com/repos/tanphung/VerdictProof/commits/{commit}$",
        {"status": status, "body": json.dumps({"sha": commit})},
    )
    direct_vm.mock_web(
        rf"^https://api\.github\.com/repos/tanphung/VerdictProof/contents/evidence/result\.md\?ref={commit}$",
        {
            "status": status,
            "body": json.dumps(
                {
                    "type": "file",
                    "path": "evidence/result.md",
                    "encoding": encoding,
                    "sha": blob,
                    "size": len(data) if api_size is None else api_size,
                    "content": base64.b64encode(data).decode("ascii"),
                }
            ),
        },
    )
    return hashlib.sha256(data).hexdigest(), len(data)


def uleb(value):
    output = bytearray()
    while True:
        byte = value & 127
        value >>= 7
        output.append(byte | (128 if value else 0))
        if not value:
            return bytes(output)


def encode_value(value):
    if value is None:
        return uleb(0)
    if value is False:
        return uleb(8)
    if value is True:
        return uleb(16)
    if isinstance(value, int):
        return uleb((value << 3) | 1)
    if isinstance(value, str) and value.startswith("0x") and len(value) == 42:
        return uleb(24) + bytes.fromhex(value[2:])
    if isinstance(value, str):
        raw = value.encode("utf-8")
        return uleb((len(raw) << 3) | 4) + raw
    if isinstance(value, list):
        return uleb((len(value) << 3) | 5) + b"".join(encode_value(item) for item in value)
    if isinstance(value, dict):
        output = bytearray(uleb((len(value) << 3) | 6))
        for key, item in value.items():
            raw_key = key.encode("utf-8")
            output.extend(uleb(len(raw_key)))
            output.extend(raw_key)
            output.extend(encode_value(item))
        return bytes(output)
    raise TypeError(value)


def rlp_bytes(value):
    size = len(value)
    if size <= 55:
        return bytes([128 + size]) + value
    length = size.to_bytes((size.bit_length() + 7) // 8, "big")
    return bytes([183 + len(length)]) + length + value


def rlp_list(payload):
    size = len(payload)
    if size <= 55:
        return bytes([192 + size]) + payload
    length = size.to_bytes((size.bit_length() + 7) // 8, "big")
    return bytes([247 + len(length)]) + length + payload


def calldata(method="release", **changes):
    kwargs = {
        "task_identifier": "TASK-001",
        "deal_id": "DEAL-001",
        "recipient": BENEFICIARY,
        "amount_atto": REWARD,
        "kind": "RELEASE",
        "released": True,
    }
    kwargs.update(changes)
    payload = encode_value({"method": method, "args": [], "kwargs": kwargs})
    return rlp_list(rlp_bytes(payload)).hex()


def mock_receipt(direct_vm, tester, *, tx_hash=TX_HASH, sender=None, recipient=SOURCE, status=7, result=1, execution=1, call=None):
    sender_value = tester if sender is None else sender
    tester_text = f"0x{sender_value.hex()}" if isinstance(sender_value, bytes) else str(sender_value)
    direct_vm.mock_web(
        r"^https://rpc-bradbury\.genlayer\.com$",
        {
            "method": "POST",
            "status": 200,
            "body": json.dumps(
                {
                    "jsonrpc": "2.0",
                    "result": {
                        "id": tx_hash,
                        "sender": tester_text,
                        "recipient": recipient,
                        "status": status,
                        "result": result,
                        "txExecutionResult": execution,
                        "txCallData": call or calldata(),
                    },
                    "id": 1,
                }
            ),
        },
    )


def llm_result(*, violated=None, chunks=None, approved_scores=True):
    violated = violated or []
    chunks = chunks if chunks is not None else [0, 1]
    assessments = []
    for index, oid in enumerate(("OBL-001", "OBL-002")):
        assessments.append(
            {
                "obligation_id": oid,
                "verdict": "VIOLATED" if oid in violated else "SATISFIED",
                "evidence_id": "ARTIFACT_PRIMARY",
                "chunk_citations": [min(index, max(chunks))] if chunks else [0],
                "reason_code": "CONTRADICTION_FOUND" if oid in violated else "ACTION_CONFIRMED",
            }
        )
    return {
        "reviewed_chunks": chunks,
        "assessments": assessments,
        "task_completed": not violated,
        "proof_score": 40 if approved_scores else 20,
        "feedback_score": 20,
        "insight_score": 16,
        "originality_score": 12,
        "reason_summary": "Complete evidence review finished.",
        "evidence_summary": "All immutable chunks were examined.",
        "improvement_recommendation": "Resolve any violated obligation.",
        "risk_flags": "NONE" if not violated else "OBLIGATION_VIOLATION",
        "proof_reason": "Proof follows cited chunks.",
        "feedback_reason": "Feedback is evidence grounded.",
        "insight_reason": "Insight is actionable.",
        "originality_reason": "Observation is task specific.",
        "task_analysis": "Every obligation was assessed exactly once.",
    }


def create_campaign(contract, direct_vm, policy_value=None, *, pool=POOL, reward=REWARD):
    direct_vm.warp(NOW_ISO)
    mock_repo(direct_vm)
    direct_vm.value = pool
    cid = contract.create_campaign(
        "Full assurance campaign",
        "https://verdictproof.vercel.app",
        "Complete every accepted obligation and publish the immutable result.",
        "A finalized exact receipt and the complete authenticated artifact.",
        pool,
        reward,
        STAKE,
        75,
        json.dumps(policy_value or policy()),
    )
    direct_vm.value = 0
    return cid


def submit(contract, direct_vm, direct_alice, cid, *, text=ARTIFACT, commit=COMMIT, tx_url=TX_URL):
    digest, length = mock_artifact(direct_vm, text, commit=commit)
    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    sid = contract.submit_proof(cid, STAKE, tx_url, commit, digest, length, "The release and resulting state are documented with exact campaign-specific evidence.")
    direct_vm.value = 0
    return sid


def review(contract, direct_vm, sid, tester, *, result=None, receipt_kwargs=None, text=ARTIFACT):
    mock_artifact(direct_vm, text)
    mock_receipt(direct_vm, tester, **(receipt_kwargs or {}))
    direct_vm.mock_llm(r".*Evaluate all immutable artifact chunks independently.*", json.dumps(result or llm_result()))
    return contract.evaluate_submission(sid)


def test_create_campaign_stores_full_policy_and_repository_identity(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    cid = create_campaign(contract, direct_vm)
    campaign = contract.get_campaign(cid)
    assert campaign["revision"] == 1
    assert len(campaign["obligations"]) == 2
    assert campaign["artifact_policy"]["auth_mode"] == "GITHUB_API"
    assert campaign["repository_identity"]["repository_id"] == "12345"
    assert campaign["receipt_policy"]["deal"]["value"] == "DEAL-001"
    assert campaign["reserved_reward_pool"] == "0"


@pytest.mark.parametrize(
    "mutator,message",
    [
        (lambda p: p.update({"extra": True}), "policy has invalid fields"),
        (lambda p: p.pop("artifact"), "policy has invalid fields"),
        (lambda p: p["obligations"].append(dict(p["obligations"][0])), "obligation ids must be valid and unique"),
        (lambda p: p["artifact"].update({"auth_mode": "SIGNED_HTTP"}), "only GITHUB/GITHUB_API"),
        (lambda p: p["artifact"].update({"content_type": "application/octet-stream"}), "content type does not match"),
        (lambda p: p["receipt"]["deal"].update({"selector": "deal_id"}), "receipt selector is invalid"),
    ],
)
def test_policy_rejects_unsafe_or_ambiguous_shapes(direct_vm, direct_deploy, mutator, message):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(NOW_ISO)
    mock_repo(direct_vm)
    value = policy()
    mutator(value)
    direct_vm.value = POOL
    with direct_vm.expect_revert(message):
        contract.create_campaign("Title", "https://example.com", "Task", "Proof", POOL, REWARD, STAKE, 75, json.dumps(value))


def test_repository_wrong_owner_and_redirect_are_rejected(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(NOW_ISO)
    mock_repo(direct_vm, owner="attacker")
    direct_vm.value = POOL
    with direct_vm.expect_revert("GitHub repository identity mismatch"):
        contract.create_campaign("Title", "https://example.com", "Task", "Proof", POOL, REWARD, STAKE, 75, json.dumps(policy()))
    direct_vm.clear_mocks()
    mock_repo(direct_vm, status=302)
    with direct_vm.expect_revert("redirected"):
        contract.create_campaign("Title", "https://example.com", "Task", "Proof", POOL, REWARD, STAKE, 75, json.dumps(policy()))


def test_github_rate_limit_is_transient_not_provenance_rejection(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    module = sys.modules[type(contract).__module__]
    direct_vm.mock_web(
        r"^https://api\.github\.com/rate-limited$",
        {"status": 403, "body": json.dumps({"message": "API rate limit exceeded"})},
    )
    with direct_vm.expect_revert("[TRANSIENT] GitHub test rate limited"):
        module._web_json("https://api.github.com/rate-limited", "GitHub test")


def test_revision_allowed_only_before_first_submission(direct_vm, direct_deploy, direct_alice, direct_owner):
    contract = direct_deploy(CONTRACT)
    cid = create_campaign(contract, direct_vm)
    revised = policy(submission_deadline=NOW + 3 * 86400)
    mock_repo(direct_vm)
    result = contract.revise_campaign(cid, "Revised task", "Revised proof", json.dumps(revised))
    assert result["revision"] == 2
    submit(contract, direct_vm, direct_alice, cid)
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("immutable after first submission"):
        contract.revise_campaign(cid, "Again", "Again", json.dumps(revised))


def test_submit_authenticates_full_artifact_and_reserves_reward(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_campaign(contract, direct_vm)
    sid = submit(contract, direct_vm, direct_alice, cid)
    submission = contract.get_submission(sid)
    campaign = contract.get_campaign(cid)
    assert submission["artifact_sha256"] == hashlib.sha256(ARTIFACT.encode()).hexdigest()
    assert submission["artifact_byte_length"] == len(ARTIFACT.encode())
    assert submission["total_chunks"] == 2
    assert len(submission["chunk_digests"]) == 2
    assert submission["provenance_manifest"]["owner_id"] == "6789"
    assert submission["reservation_status"] == "RESERVED"
    assert campaign["reward_pool"] == str(POOL - REWARD)
    assert campaign["reserved_reward_pool"] == str(REWARD)


def test_duplicate_transaction_and_artifact_are_consumed_globally(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    cid = create_campaign(contract, direct_vm)
    submit(contract, direct_vm, direct_alice, cid)
    digest, length = mock_artifact(direct_vm)
    direct_vm.sender = direct_bob
    direct_vm.value = STAKE
    with direct_vm.expect_revert("transaction evidence has already been consumed"):
        contract.submit_proof(cid, STAKE, TX_URL + "?source=x#ignored", COMMIT, digest, length, "Unused evidence should fail.")
    mock_artifact(direct_vm)
    with direct_vm.expect_revert("artifact evidence has already been consumed"):
        contract.submit_proof(cid, STAKE, f"https://explorer-bradbury.genlayer.com/tx/{TX_HASH_2}", COMMIT, digest, length, "Same immutable artifact should fail.")


def test_declared_digest_mismatch_reverts_without_consumption(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_campaign(contract, direct_vm)
    _, length = mock_artifact(direct_vm)
    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    with direct_vm.expect_revert("declared artifact digest or byte length mismatch"):
        contract.submit_proof(cid, STAKE, TX_URL, COMMIT, "0" * 64, length, "Mismatched declaration.")
    assert contract.get_campaign(cid)["submission_count"] == 0
    assert contract.get_evidence_usage(cid, TX_URL, COMMIT)["available"] is True


@pytest.mark.parametrize(
    "text,encoding,api_size,message",
    [
        (b"\xff\xfe", "base64", None, "must be UTF-8"),
        ("x" * 4097, "base64", None, "1..4096 bytes"),
        (ARTIFACT, "utf-8", None, "identity or encoding mismatch"),
        (ARTIFACT, "base64", 1, "1..4096 bytes"),
    ],
)
def test_artifact_rejects_binary_oversize_bad_encoding_and_size(direct_vm, direct_deploy, direct_alice, text, encoding, api_size, message):
    contract = direct_deploy(CONTRACT)
    cid = create_campaign(contract, direct_vm)
    digest, length = mock_artifact(direct_vm, text, encoding=encoding, api_size=api_size)
    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    with direct_vm.expect_revert(message):
        contract.submit_proof(cid, STAKE, TX_URL, COMMIT, digest, min(length, 4096), "Adversarial artifact.")


def test_valid_prefix_conflicting_tail_is_reviewed_and_rejected(direct_vm, direct_deploy, direct_alice):
    text = "Valid-looking completion. " + ("supporting detail " * 80) + "CONTRADICTION: OBL-002 was not completed."
    contract = direct_deploy(CONTRACT)
    cid = create_campaign(contract, direct_vm)
    sid = submit(contract, direct_vm, direct_alice, cid, text=text)
    total = contract.get_submission(sid)["total_chunks"]
    result = llm_result(violated=["OBL-002"], chunks=list(range(total)))
    result["assessments"][1]["chunk_citations"] = [total - 1]
    reviewed = review(contract, direct_vm, sid, contract.get_submission(sid)["tester"], result=result, text=text)
    assert reviewed["status"] == "REJECTED"
    assert reviewed["reviewed_chunks"] == list(range(total))
    assert reviewed["obligation_assessments"][1]["verdict"] == "VIOLATED"
    assert reviewed["obligation_assessments"][1]["chunk_citations"] == [total - 1]


@pytest.mark.parametrize("mutation,message", [
    (lambda r: r.update({"reviewed_chunks": [0]}), "reviewed_chunks must cover"),
    (lambda r: r.update({"assessments": r["assessments"][:1]}), "every obligation must be assessed"),
    (lambda r: r["assessments"].append(dict(r["assessments"][0])), "every obligation must be assessed"),
    (lambda r: r["assessments"][1].update({"obligation_id": "OBL-999"}), "id is missing, duplicate, or extra"),
    (lambda r: r["assessments"][0].update({"chunk_citations": [99]}), "chunk citation is invalid"),
])
def test_incomplete_or_fabricated_review_rotates_without_settlement(direct_vm, direct_deploy, direct_alice, mutation, message):
    contract = direct_deploy(CONTRACT)
    cid = create_campaign(contract, direct_vm)
    sid = submit(contract, direct_vm, direct_alice, cid)
    result = llm_result()
    mutation(result)
    mock_artifact(direct_vm)
    mock_receipt(direct_vm, contract.get_submission(sid)["tester"])
    direct_vm.mock_llm(r".*Evaluate all immutable artifact chunks independently.*", json.dumps(result))
    with direct_vm.expect_revert(message):
        contract.evaluate_submission(sid)
    pending = contract.get_submission(sid)
    assert pending["status"] == "PENDING"
    assert pending["reservation_status"] == "RESERVED"


def test_reason_code_format_is_defensively_normalized(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_campaign(contract, direct_vm)
    sid = submit(contract, direct_vm, direct_alice, cid)
    result = llm_result()
    result["assessments"][0]["reason_code"] = "action confirmed: exact evidence"
    reviewed = review(contract, direct_vm, sid, contract.get_submission(sid)["tester"], result=result)
    assert reviewed["obligation_assessments"][0]["reason_code"] == "ACTION_CONFIRMED_EXACT_EVIDENCE"


def test_task_completed_is_derived_from_exact_obligation_vector(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_campaign(contract, direct_vm)
    sid = submit(contract, direct_vm, direct_alice, cid)
    result = llm_result()
    result["task_completed"] = False
    reviewed = review(contract, direct_vm, sid, contract.get_submission(sid)["tester"], result=result)
    assert reviewed["task_completed"] is True
    assert reviewed["approved"] is True


@pytest.mark.parametrize("receipt_kwargs", [
    {"sender": "0x2222222222222222222222222222222222222222"},
    {"recipient": "0x2222222222222222222222222222222222222222"},
    {"call": calldata(method="refund")},
    {"call": calldata(task_identifier="WRONG")},
    {"call": calldata(deal_id="WRONG")},
    {"call": calldata(recipient="0x2222222222222222222222222222222222222222")},
    {"call": calldata(amount_atto=REWARD + 1)},
    {"call": calldata(kind="REFUND")},
    {"call": calldata(released=False)},
    {"call": "00"},
    {"result": 2},
    {"execution": 2},
])
def test_exact_receipt_fact_mismatch_always_rejects(direct_vm, direct_deploy, direct_alice, receipt_kwargs):
    contract = direct_deploy(CONTRACT)
    cid = create_campaign(contract, direct_vm)
    sid = submit(contract, direct_vm, direct_alice, cid)
    result = review(contract, direct_vm, sid, contract.get_submission(sid)["tester"], receipt_kwargs=receipt_kwargs)
    assert result["status"] == "REJECTED"
    assert result["usage_valid"] is False
    assert result["proof_score"] == 0
    assert result["reservation_status"] == "RELEASED"


def test_not_finalized_is_transient_and_keeps_reservation(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_campaign(contract, direct_vm)
    sid = submit(contract, direct_vm, direct_alice, cid)
    mock_artifact(direct_vm)
    mock_receipt(direct_vm, contract.get_submission(sid)["tester"], status=6)
    with direct_vm.expect_revert("not finalized"):
        contract.evaluate_submission(sid)
    assert contract.get_submission(sid)["reservation_status"] == "RESERVED"


def test_valid_full_review_claim_and_close(direct_vm, direct_deploy, direct_alice, direct_owner):
    contract = direct_deploy(CONTRACT)
    cid = create_campaign(contract, direct_vm)
    sid = submit(contract, direct_vm, direct_alice, cid)
    result = review(contract, direct_vm, sid, contract.get_submission(sid)["tester"])
    assert result["status"] == "APPROVED"
    assert result["reservation_status"] == "CONSUMED"
    assert all(item["verdict"] == "SATISFIED" for item in result["obligation_assessments"])
    direct_vm.sender = direct_owner
    closed = contract.close_campaign(cid)
    assert closed["kind"] == "CAMPAIGN_CLOSE_REFUND"
    direct_vm.sender = direct_alice
    claimed = contract.claim_reward(sid)
    assert claimed["paid_atto"] == str(STAKE + REWARD)
    assert contract.get_submission(sid)["settlement_record"]["released"] is True


def test_expiry_releases_reservation_refunds_stake_and_keeps_evidence_consumed(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    cid = create_campaign(contract, direct_vm)
    sid = submit(contract, direct_vm, direct_alice, cid)
    direct_vm.warp("2026-09-01T00:00:02Z")
    result = contract.expire_submission(sid)
    assert result["status"] == "EXPIRED"
    assert result["settlement_record"]["kind"] == "EXPIRY_REFUND"
    assert contract.get_campaign(cid)["reserved_reward_pool"] == "0"
    assert contract.get_evidence_usage(cid, TX_URL, COMMIT)["available"] is False


def test_capacity_exhaustion_reverts_before_fetch_or_consumption(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    cid = create_campaign(contract, direct_vm, pool=10**17, reward=10**17)
    submit(contract, direct_vm, direct_alice, cid)
    direct_vm.clear_mocks()
    direct_vm.sender = direct_bob
    direct_vm.value = STAKE
    with direct_vm.expect_revert("no unreserved reward capacity"):
        contract.submit_proof(cid, STAKE, f"https://explorer-bradbury.genlayer.com/tx/{TX_HASH_2}", COMMIT_2, "1" * 64, 1, "No capacity.")
    assert contract.get_campaign(cid)["submission_count"] == 1


def test_comparator_rejects_missing_obligation_and_threshold_side(direct_deploy):
    contract = direct_deploy(CONTRACT)
    module = sys.modules[type(contract).__module__]
    left = llm_result()
    left.update({"all_obligations_satisfied": True, "usage_valid": True, "approved": True, "score": 88})
    right = dict(left)
    right["assessments"] = left["assessments"][:1]
    assert module._review_equal(left, right, 75) is False
    right = dict(left)
    right.update({"score": 74, "approved": False})
    assert module._review_equal(left, right, 75) is False


def test_artifact_comparator_rejects_missing_reordered_or_changed_chunks(direct_deploy):
    contract = direct_deploy(CONTRACT)
    module = sys.modules[type(contract).__module__]
    chunks, digests = module._chunks(ARTIFACT)
    artifact = {
        "canonical_origin": f"github://12345/{COMMIT}/evidence/result.md",
        "artifact_key": f"github://12345/{COMMIT}/evidence/result.md",
        "repository_id": "12345",
        "repository_node_id": "R_repo_node",
        "owner_id": "6789",
        "owner": "tanphung",
        "repository": "VerdictProof",
        "commit_sha": COMMIT,
        "path": "evidence/result.md",
        "content_type": "text/markdown",
        "byte_length": len(ARTIFACT.encode()),
        "blob_sha": BLOB,
        "sha256": hashlib.sha256(ARTIFACT.encode()).hexdigest(),
        "total_chunks": len(chunks),
        "chunk_digests": digests,
        "chunks": chunks,
    }
    assert module._artifact_equal(artifact, copy.deepcopy(artifact)) is True
    missing = copy.deepcopy(artifact)
    missing["chunks"] = missing["chunks"][:-1]
    assert module._artifact_equal(artifact, missing) is False
    reordered = copy.deepcopy(artifact)
    reordered["chunk_digests"] = list(reversed(reordered["chunk_digests"]))
    assert module._artifact_equal(artifact, reordered) is False
    changed = copy.deepcopy(artifact)
    changed["sha256"] = "0" * 64
    assert module._artifact_equal(artifact, changed) is False
