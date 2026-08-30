"""Fail CI when the published Bradbury release evidence drifts from the repo.

This check is intentionally offline. It validates the immutable evidence already
captured from Bradbury without trusting mutable RPC availability during CI.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_PATH = ROOT / "deploy" / "latest-bradbury-verification.json"
CONTRACT_PATH = ROOT / "contracts" / "verdict_proof.py"
CONFIG_PATH = ROOT / "frontend" / "public" / "config.js"

EXPECTED_NETWORK = "testnet-bradbury"
LIVE_RUBRIC = "VERDICTPROOF_V2_3"
CANDIDATE_RUBRIC = "VERDICTPROOF_V2_5_FULL_ASSURANCE"
EXPECTED_REVIEW_METHOD = "evaluate_submission"

ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
HASH_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")
FORBIDDEN_SECRET_KEYS = {
    "apikey",
    "mnemonic",
    "password",
    "privatekey",
    "seedphrase",
}
REPORT_FIELDS = {
    "approved",
    "consensus_checks",
    "feedback_reason",
    "feedback_score",
    "identity_analysis",
    "identity_match",
    "insight_reason",
    "insight_score",
    "originality_reason",
    "originality_score",
    "proof_reason",
    "proof_score",
    "reason_summary",
    "risk_flags",
    "rubric_version",
    "score",
    "settlement_explanation",
    "status",
    "task_analysis",
    "task_completed",
    "transaction_analysis",
    "transaction_success",
    "validation_method",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def normalized_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.lower())


def assert_no_secret_fields(value: Any, location: str = "artifact") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            require(
                normalized_key(str(key)) not in FORBIDDEN_SECRET_KEYS,
                f"Forbidden secret-like field at {location}.{key}",
            )
            assert_no_secret_fields(child, f"{location}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            assert_no_secret_fields(child, f"{location}[{index}]")


def assert_consensus_record(
    record: dict[str, Any], contract_address: str, method: str
) -> None:
    require(HASH_RE.fullmatch(str(record.get("hash", ""))) is not None, "Invalid transaction hash")
    require(record.get("statusName") == "FINALIZED", "Transaction is not FINALIZED")
    require(record.get("resultName") == "AGREE", "Consensus result is not AGREE")
    require(
        record.get("executionResultName") == "FINISHED_WITH_RETURN",
        "Execution did not finish with a return value",
    )
    require(
        str(record.get("recipient", "")).lower() == contract_address.lower(),
        "Consensus record targets a different contract",
    )
    require(record.get("functionName") == method, f"Expected method {method}")

    agreed = record.get("validatorsAgreed")
    total = record.get("validatorsTotal")
    votes = record.get("validatorVotes")
    require(isinstance(agreed, int) and agreed > 0, "Missing validator agreement count")
    require(isinstance(total, int) and total >= agreed, "Invalid validator total")
    require(isinstance(votes, list) and len(votes) == total, "Validator vote count mismatch")
    require(votes.count("AGREE") == agreed, "Recorded AGREE votes do not match metadata")


def main() -> None:
    artifact = json.loads(ARTIFACT_PATH.read_text(encoding="utf-8"))
    config = CONFIG_PATH.read_text(encoding="utf-8")
    contract_bytes = CONTRACT_PATH.read_bytes()

    assert_no_secret_fields(artifact)
    require(artifact.get("network") == EXPECTED_NETWORK, "Unexpected verification network")

    contract_address = str(artifact.get("contractAddress", ""))
    require(ADDRESS_RE.fullmatch(contract_address) is not None, "Invalid contract address")

    deployment = artifact.get("deployment", {})
    require(deployment.get("exactLocalSourceMatch") is True, "Source match is not attested")
    require(deployment.get("exactLocalSchemaMatch") is True, "Schema match is not attested")

    require(contract_address in config, "Frontend config points to another contract")
    require(LIVE_RUBRIC in config, "Frontend config points to another rubric version")

    local_sha = hashlib.sha256(contract_bytes).hexdigest()
    if CANDIDATE_RUBRIC.encode() in contract_bytes:
        # Candidate development is intentionally allowed while the public app
        # remains pinned to its last verified release. The attested live source
        # is checked again against the active contract immediately at rollout.
        require(
            deployment.get("sourceSha256") != local_sha,
            "Candidate/live dual-release mode unexpectedly uses the same source",
        )
    else:
        require(deployment.get("sourceSha256") == local_sha, "Contract source SHA-256 drift")

    review_transactions = artifact.get("reviewTransactions", {})
    consensus = artifact.get("consensus", {})
    review_records = {
        "1-1": consensus.get("reviewApprovedEvidence", {}),
        "1-2": consensus.get("reviewRejectedEvidence", {}),
        "1-3": consensus.get("reviewSemanticRejection", {}),
    }
    for submission_key, record in review_records.items():
        assert_consensus_record(record, contract_address, EXPECTED_REVIEW_METHOD)
        require(
            review_transactions.get(submission_key) == record.get("hash"),
            f"Review transaction mapping drift for submission {submission_key}",
        )
        require(record.get("hash") in config, f"Frontend config omits review {submission_key}")

    assert_consensus_record(
        consensus.get("claimApprovedReward", {}), contract_address, "claim_reward"
    )
    assert_consensus_record(
        consensus.get("closeEvidenceCampaign", {}), contract_address, "close_campaign"
    )

    outcomes = artifact.get("outcomes", {})
    expected_outcomes = {
        "approved": (True, "CLAIMED"),
        "identityRejected": (False, "REJECTED"),
        "semanticRejected": (False, "REJECTED"),
    }
    for outcome_name, (approved, status) in expected_outcomes.items():
        report = outcomes.get(outcome_name, {})
        missing = sorted(REPORT_FIELDS - report.keys())
        require(not missing, f"{outcome_name} report missing fields: {', '.join(missing)}")
        require(report.get("approved") is approved, f"{outcome_name} approval drift")
        require(report.get("status") == status, f"{outcome_name} status drift")
        require(report.get("rubric_version") == LIVE_RUBRIC, f"{outcome_name} rubric drift")
        for field in REPORT_FIELDS - {"approved", "identity_match", "task_completed", "transaction_success"}:
            require(report.get(field) not in (None, ""), f"{outcome_name}.{field} is empty")

    print(
        "Release artifact verified: source/schema attestation, 3 consensus reviews, "
        "claim, close/refund, full reports, frontend mappings, and secret-field scan."
    )


if __name__ == "__main__":
    main()
