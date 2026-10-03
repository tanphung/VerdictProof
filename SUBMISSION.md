# VerdictProof — V2.6 steward resubmission draft

**Not ready to submit:** fresh Bradbury workflow verification and frontend promotion are still in progress. Do not present the historical V2.3 app as the V2.6 release.

The initial split deployment is superseded: its runner header was ignored and
three approval review attempts failed consensus without settlement. Revision r2
corrects the header and makes output structure and obligation scope explicit.
Use only r2's completed workflow as resubmission evidence; see
`docs/V2_6_R2_RELEASE.md`.

## Changes addressing the steward request

1. Every campaign freezes an expected receipt destination contract, method and task identifier, plus deal, beneficiary, amount, kind and released state. Receipt sender must match the submitting tester.
2. Canonical transaction hashes and immutable `github://repository_id/commit/path` references are consumed globally once at submission acceptance, including across campaigns. SHA-256 and ordered chunk digests establish complete artifact integrity.
3. Submission acceptance reserves the entire reward atomically. Approval consumes that reservation even with zero available pool. Insufficient capacity rejects before retaining stake or consuming evidence.
4. Policy becomes immutable after the first accepted submission. Transient review failure keeps the reservation; timeout returns stake and releases capacity; approved claims survive campaign closure.

## Independent validation

Receipt and provenance helpers independently refetch objective evidence for leader/validator comparison. The review helper independently evaluates every agreed artifact chunk and obligation. Receipt facts, obligation decisions and threshold side must agree; subjective scores use bounded tolerances. The UI displays the consensus-committed leader narrative and actual vote metadata.

## Split deployment

Bradbury's gas limit prevented the monolithic deployment. The new settlement core uses three fixed, stateless helper contracts. Money, evidence-consumption registries and reservations remain in the core, preserving atomic acceptance and settlement. See `docs/V2_6_ARCHITECTURE.md`.

## Verified development checks

These counts describe the initial split source. Do not claim they have been
rerun against r2 until that verification is recorded. All five r2 contracts have
passed GenVM lint; fresh Bradbury verification is in progress.

- 126 direct tests: the regression suite against both monolithic reference and split contracts.
- Real StudioNet split-contract approval with zero available pool, followed by close and claim.
- 36 frontend tests, 11 verification-runner tests, lint and production build.

## Required evidence before sending

Attach the final V2.6 commit and app URL, core plus all helper deployment/source/schema attestations, finalized approved/rejected reviews, exact replay/capacity rejection reasons, zero-available-pool reservation proof, claim, expiry/refund and campaign-close records. `deploy/v2.6-bradbury-verification.json` must exist and pass release checks. Publish the runtime address, rubric and review mappings together only after this completes.
