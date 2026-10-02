# V2.6 split contracts

Bradbury rejected the 54 KB monolith at transaction admission (`gas limit too high`). The split preserves the public campaign/submission API and keeps all money and mutable campaign state in one core.

| Contract | Responsibility | Mutable state |
| --- | --- | --- |
| VerdictProof | Campaigns, stake, globally consumed references, reservations, approval/rejection, claim, expiry, close | All financial and lifecycle state |
| ProofProvenance | Strict policy parsing, stable repository identity, full artifact bytes, SHA-256, ordered chunks | None |
| ProofReceipt | Finalized receipt fetch, calldata decoding, exact sender/contract/method/task/deal/beneficiary/amount/kind/state checks | None |
| ProofReview | Independent full-artifact semantic review, obligation vector, bounded score comparison; deterministic pending-report defaults | None |

## Call and trust boundaries

The core constructor fixes the three helper addresses and checks each helper's module and rubric identifier. There is no setter, upgrade method, or helper callback into the core. Deployment verification additionally checks exact helper source/schema and the core's `get_components` output. Module identifiers alone are not a cryptographic source attestation: reviewers should use the deployment report.

Cross-contract view calls occur in deterministic execution. Each helper runs its own leader/validator callback inside its view method. Validators independently refetch objective evidence in the receipt and provenance phases. After these phases agree, the semantic phase independently evaluates every agreed artifact chunk. No cross-contract call occurs inside a nondeterministic callback.

The core commits settlement only after all phases return successfully. A failed helper call leaves the submission pending and its reward reserved. Helpers have no write methods and cannot transfer or slash core funds.

Acceptance consumes transaction/artifact references and reserves a full reward in the same core transaction. JSON strings in typed TreeMaps hold campaign/submission records; monetary values are stored and returned as decimal strings, preserving the frontend schema. The three constructor addresses are the only deployment API change; `get_components` is an additional view.

## Verification

The same direct regression suite runs against both the preserved pre-split reference and the split contracts: 126 tests total. The direct harness routes view transport to actual helper methods; it is not a GenVM sub-VM emulator. StudioNet separately exercises real cross-contract calls, independent consensus, accepted artifact verification, approval with zero available pool, and claim after closure. Fresh Bradbury cases and final settlement remain mandatory before promotion.

The baseline is `tests/reference/verdict_proof_v26_monolith.py`; it is a regression reference and is not deployed.

The verification runner may advance dependent steps using explicit `latest-nonfinal` reads after acceptance. It finalizes all recorded transactions before publishing evidence or a checkpoint report. The app and read-only release inspection use explicit `latest-final` reads. The SDK does not support a `stateStatus` read parameter.
