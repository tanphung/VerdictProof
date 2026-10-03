"""Validate a completed V2.6 report before promoting the public runtime.

This is an offline consistency check; the live runner supplies RPC attestations.
It deliberately fails when only a deployment/progress report exists.
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUBRIC = "VERDICTPROOF_V2_6_STEWARD_REMEDIATION"


def require(value, message):
    if not value:
        raise AssertionError(message)


def transaction(row, method, address, error=False):
    require(re.fullmatch(r"0x[0-9a-fA-F]{64}", row["hash"]), "Invalid transaction hash")
    require(row["statusName"] == "FINALIZED" and row["resultName"] == "AGREE", "Unfinalized or disputed transaction")
    require(row["functionName"] == method and row["recipient"].lower() == address.lower(), "Wrong transaction target/method")
    failed = any(token in row["executionResultName"] for token in ("ERROR", "REVERT", "FAILED"))
    require(failed if error else row["executionResultName"] == "FINISHED_WITH_RETURN", "Unexpected execution result")
    require(row["validatorsTotal"] >= 5 and row["validatorsAgreed"] > row["validatorsTotal"] / 2, "Missing majority vote evidence")


def verify(report):
    require(report["network"] == "testnet-bradbury" and report["rubricVersion"] == RUBRIC, "Wrong release")
    require(re.fullmatch(r"[0-9a-f]{40}", report["artifactCommit"]), "Missing immutable artifact commit")
    require(re.fullmatch(r"[0-9a-f]{40}", report["secondaryArtifactCommit"]), "Missing secondary immutable artifact commit")
    require(report["artifactCommit"] != report["secondaryArtifactCommit"], "Capacity reference must be distinct")
    for file in ("verdict_proof", "proof_provenance", "proof_receipt", "proof_review", "evidence_escrow"):
        path = f"contracts/{file}.py"
        deployment = report["deployments"][path]
        require(deployment["exactSourceMatch"] and deployment["exactSchemaMatch"], f"Missing attestation: {file}")
        require(hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == deployment["sourceSha256"], f"Source drift: {file}")
        consensus = deployment["consensus"]
        require(consensus["statusName"] == "FINALIZED" and consensus["resultName"] == "AGREE" and consensus["executionResultName"] == "FINISHED_WITH_RETURN", f"Deployment not finalized: {file}")
    core = report["contractAddress"]
    require(core.lower() == report["deployments"]["contracts/verdict_proof.py"]["contractAddress"].lower(), "Core address mismatch")
    for key, name in (("provenance", "proof_provenance"), ("receipt", "proof_receipt"), ("reviewer", "proof_review")):
        require(report["components"][key].lower() == report["deployments"][f"contracts/{name}.py"]["contractAddress"].lower(), "Helper binding mismatch")
    for key, row in report["reviews"].items():
        transaction(row["record"], "evaluate_submission", core)
        submission = row["submission"]
        require(submission["rubric_version"] == RUBRIC, "Wrong review rubric")
        require(submission["reviewed_chunks"] == list(range(int(submission["total_chunks"]))), "Incomplete chunk review")
        require(submission["approved"] is (key == "approved"), "Unexpected verdict")
        require(submission["commit_sha"] == report["artifactCommit"], "Review uses a different artifact commit")
        manifest = submission["provenance_manifest"]
        require(manifest["sha256"] == submission["artifact_sha256"] and manifest["byte_length"] == submission["artifact_byte_length"], "Artifact manifest mismatch")
        require(manifest["chunk_digests"] == submission["chunk_digests"] and len(submission["chunk_digests"]) == int(submission["total_chunks"]), "Chunk manifest mismatch")
    approved = report["reviews"]["approved"]["submission"]
    require(approved["receipt_checks"]["all_match"], "Approval has a failed receipt gate")
    require(all(item["verdict"] == "SATISFIED" for item in approved["obligation_assessments"]), "Approval has a violated obligation")
    binding = report["reviews"]["bindingRejected"]["submission"]["receipt_checks"]
    require(binding["task_identifier_match"] is False and binding["all_match"] is False, "Binding case does not fail task attribution")
    require(all(value is True for key, value in binding.items() if key not in ("task_identifier_match", "all_match")), "Binding case has unrelated failed gates")
    semantic = report["reviews"]["semanticRejected"]["submission"]
    require(semantic["receipt_checks"]["all_match"] is True, "Semantic case has an unrelated receipt failure")
    require(any(item["obligation_id"] == "OBL-003" and item["verdict"] == "VIOLATED" for item in semantic["obligation_assessments"]), "Semantic case does not violate the required accounting obligation")
    before = report["reservationRegression"]["campaignBeforeReview"]
    require(int(before["reward_pool"]) == 0 and int(before["reserved_reward_pool"]) == int(approved["reserved_reward_amount"]), "Missing zero-capacity reservation proof")
    for key, row in report["expectedFailures"].items():
        transaction(row["record"], "submit_proof", core, error=True)
        require(row["before"] == row["after"] and row["campaignBefore"] == row["campaignAfter"], "Failed submission mutated state")
        require(f'[EXPECTED] {row["expectedReason"]}' in row["observedReason"], "Wrong rejection reason")
        if key == "capacityExhaustion":
            require(row["before"]["available"] and int(row["campaignBefore"]["reward_pool"]) == 0, "Missing atomic capacity proof")
    settlements = report["settlements"]
    transaction(settlements["claim"], "claim_reward", core)
    transaction(settlements["expiry"], "expire_submission", core)
    claimed = settlements["claimed"]
    require(claimed["status"] == "CLAIMED" and claimed["reservation_status"] == "CONSUMED", "Claim incomplete")
    require(int(claimed["settlement_record"]["amount_atto"]) == int(claimed["stake_amount"]) + int(claimed["reserved_reward_amount"]), "Wrong claim amount")
    expired = settlements["expired"]
    require(expired["status"] == "EXPIRED" and expired["reservation_status"] == "RELEASED", "Expiry incomplete")
    require(expired["settlement_record"]["kind"] == "EXPIRY_REFUND" and expired["settlement_record"]["amount_atto"] == expired["stake_amount"], "Wrong expiry refund")
    for key, tx in settlements["close"].items():
        transaction(tx, "close_campaign", core)
        campaign = report["finalCampaigns"][key]
        require(campaign["status"] == "CLOSED" and int(campaign["reward_pool"]) == 0 and int(campaign["reserved_reward_pool"]) == 0, "Unclosed campaign")
    require(len(settlements["close"]) == len(report["campaigns"]) == 8, "Missing scenario settlement")
    print("V2.6 completed release evidence is internally consistent with local source.")


if __name__ == "__main__":
    verify(json.loads((ROOT / "deploy/v2.6-bradbury-verification.json").read_text()))
