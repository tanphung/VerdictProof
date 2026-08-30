# VerdictProof V2.5 release evidence

## OBL-001 — Exact campaign binding

The tester funded and released the configured escrow deal using the exact task identifier, deal ID, recipient, amount, `RELEASE` kind, and released state required by the campaign policy.

## OBL-002 — Full artifact verification

This complete immutable artifact is fetched through the GitHub API at a forty-character commit SHA. Validators recompute its byte length, full SHA-256 digest, deterministic chunk boundaries, and ordered chunk digests before reviewing every obligation.

## OBL-003 — Settlement accounting

VerdictProof reserves the campaign reward when the submission is accepted. Approval consumes that reservation and makes the tester stake plus reward claimable without consulting the remaining available pool.
