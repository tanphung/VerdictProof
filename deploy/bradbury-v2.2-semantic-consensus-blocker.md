# VerdictProof V2.2 — Bradbury semantic consensus blocker

Date: 2026-08-12

## Scope

This report records the mandatory Bradbury verification stop condition for VerdictProof V2.2. It is not a successful public verification artifact and does not replace `latest-bradbury-verification.json`.

## Deployment

- Contract: `0xf66C361E8D9F9A4cD87D774aa1b0E6B7fF03b3A4`
- Deployment transaction: `0x54e9a355d7a78063cca3911444419cdb68d4e4a005f21476f537909b7b533fd4`
- Deployment result: `FINALIZED / AGREE / FINISHED_WITH_RETURN`
- Local/deployed source SHA-256: `beb10785ccf2544c409d7c2405cfb3de076323d5339f86a457095c46c5c62cc5`
- Rubric version: `VERDICTPROOF_V2_2`
- Deployed source and schema were checked against the local contract before workflow verification.

## Gates completed before the blocker

- GenVM lint passed.
- 34 direct contract tests passed.
- StudioNet integration consensus test passed.
- 30 frontend tests passed.
- Frontend production build and dependency audit passed.
- Valid semantic evidence review committed successfully:
  - Transaction: `0x02ef8a05a32e744c9ae0addfca3a1dc69daacfa8d1f68874a655704b2b54c3fa`
  - Result: `FINALIZED / AGREE / FINISHED_WITH_RETURN`
  - Votes: 4 `AGREE`, 1 `DETERMINISTIC_VIOLATION`
  - Finalized submission state: `APPROVED`, score 85, `INDEPENDENT_COMPARATIVE`
- Identity mismatch hard-gate review committed successfully:
  - Transaction: `0x37f4c45333e8838018ffdb6195cfdaceca3599dd594d55f3e38ac580724e3c32`
  - Result: `FINALIZED / AGREE / FINISHED_WITH_RETURN`
  - Votes: 3 `AGREE`, 1 `DETERMINISTIC_VIOLATION`, 1 `TIMEOUT`
  - Finalized submission state: `REJECTED`, score 19, `INDEPENDENT_HARD_GATE_FEEDBACK`

## Semantic rejection blocker

The semantic mismatch submission is still `PENDING`; no rejection or settlement was committed.

### Attempt 1

- Transaction: `0xe7c890189a2bf31cda7b5cc73239e5663ce292813bf08c3ab3ffa50ed1270969`
- Final state: `FINALIZED / DISAGREE / FINISHED_WITH_RETURN`
- Rotations left: 0
- Last-round votes: 2 `TIMEOUT`, 3 `DETERMINISTIC_VIOLATION`

### Attempt 2 (single diagnostic retry)

- Transaction: `0xa4403a8a8b6333021e18f654926ad764cc8918d4b3219fbf0b04003f198a4711`
- Observed state after more than 10 minutes: `VALIDATORS_TIMEOUT / TIMEOUT / FINISHED_WITH_RETURN`
- Rotations left: 2
- Last-round votes: 1 `AGREE`, 1 `DETERMINISTIC_VIOLATION`, 3 `TIMEOUT`

The runner was stopped after this second consecutive semantic review failed to reach `FINALIZED / AGREE / FINISHED_WITH_RETURN`. No third review was submitted and no speculative V2.3 changes were made.

## Consequences and rollout status

- Submission 3 remains `PENDING`, so the primary campaign cannot be closed.
- Claim and close/refund verification were deliberately not run after the mandatory gate failed.
- The successful public verification artifact was not overwritten with partial V2.2 evidence.
- Production remains on the previously verified V2.1 contract; V2.2 was not promoted.
- VerdictProof V2.2 is not ready for a Projects submission while this blocker remains.

## Diagnosis boundary

Bradbury reads, deployment, the valid semantic path, and the identity hard-gate path all worked. The failure is therefore narrower than a general Bradbury RPC outage. It is reproducible in the semantic-rejection consensus path: validators timed out or reported deterministic violations while leader execution returned. The two transaction hashes and their traces should be sent to the GenLayer team before changing the contract again.
