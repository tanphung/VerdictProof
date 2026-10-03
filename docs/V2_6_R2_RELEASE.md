# V2.6 revision r2

This revision is not ready for resubmission until its fresh workflow report passes
the release checker and the frontend is promoted.

## Why the first deployment is superseded

The first deployment's source and schema matched the repository exactly, but its
GenVM trace warned that the runner comment did not begin with a version and used
the default runner. The dependency comment alone did not enforce the intended
pin. The official GenLayer example places `# v0.1.0` before `Depends`:
https://docs.genlayer.com/developers/intelligent-contracts/features/upgradability

Three review transactions for the approval fixture ended without consensus. Two
inspected terminal traces reported that `reviewed_chunks` did not cover the full
artifact in order. One intermediate leader also interpreted feedback proposals
as additional obligations. These observations do not prove that the header caused
the LLM failures. Both defects need to be addressed before release.

## Changes

- All five contracts declare a version before the concrete dependency pin.
- Deployment refuses missing or malformed version/pin headers.
- Chunk blocks explicitly state their zero-based index and begin/end boundaries.
- The prompt gives the exact required chunk-index JSON array and required keys.
- Obligation decisions concern the campaign requirements. Feedback suggestions
  are scored independently and cannot add new requirements.
- Receipt gates remain computed facts. Full-artifact, obligation and threshold
  comparisons, score tolerances and all settlement logic remain unchanged.
- `VERDICTPROOF_RELEASE_REVISION=r2` selects separate deployment, preflight and
  verification checkpoints. Original transactions are preserved.

The first deployed source is archived byte-for-byte under
`deploy/v2.6-initial-contracts/`, with attestations in
`deploy/v2.6-initial-deployment-check.json`. Its unfinished campaigns still need
expiry/refund and closure after their actual review deadlines. Failed consensus
attempts must not be represented as successful reviews.

## Commands

Set `$env:VERDICTPROOF_RELEASE_REVISION='r2'` for both deployment and verification.
Follow the normal five-contract deployment order, prepare fresh evidence, commit
and push it, create a distinct secondary capacity reference, then verify with the
two new immutable commit arguments. Never reuse the first revision's verification
state or assume its cases have passed on r2.
