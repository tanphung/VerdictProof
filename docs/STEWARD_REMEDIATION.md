# Steward remediation: evidence binding, replay protection, reserved rewards

The V2.6 candidate contract implements the requested changes. Publication requires a
completed Bradbury verification artifact; a matching deployment alone does not
prove the submission/review/settlement workflow.

## Acceptance criteria

| Steward concern | Contract enforcement | Regression evidence |
| --- | --- | --- |
| Evidence attributed to another task | Campaign policy fixes the receipt destination contract, method and decoded task identifier; review also checks sender, deal, beneficiary, amount, kind and released state. Policy freezes after the first accepted submission. | `test_exact_receipt_fact_mismatch_always_rejects`, `test_revision_allowed_only_before_first_submission` |
| Reused evidence | Canonical transaction hashes and `github://repository_id/commit/path` keys are consumed globally and atomically when accepting a submission. | `test_evidence_cannot_be_reused_across_campaigns_and_failure_is_atomic` |
| Valid work slashed when rewards run out | Submission moves one reward from available to reserved. Approval uses that reservation regardless of available pool balance. Capacity failure reverts before references or stake are retained. | `test_reserved_rewards_survive_zero_available_pool_in_either_review_order`, `test_capacity_revert_preserves_unused_references_and_existing_reservation` |
| Validator independence | Each validator refetches receipt and complete artifact and executes its own semantic review. Objective facts, obligation decisions and threshold side must agree; rubric components have bounded tolerances. | `test_validator_independently_reruns_evidence_and_semantics`; live consensus integration is a separate required check |

The order regression accepts two submissions until the available pool is zero,
reviews them in both orders, checks both receive their exact reserved rewards,
closes the campaign, then claims both payouts and rejects duplicate claims.

SHA-256 verifies the complete artifact and ordered chunks against the accepted
manifest. It does not establish ownership or semantic originality. Replay
protection applies to canonical references: copying bytes to another commit or
path is not treated as a duplicate reference. Every new submission must still
provide an unused finalized transaction satisfying its campaign policy.

## Release procedure

1. Run pinned GenVM lint, direct regressions, StudioNet consensus integration,
   frontend tests, verification-runner tests, production audit and build.
2. Confirm the candidate's deployed source and schema match local files.
3. Complete the checkpointed Bradbury verification, including binding failure,
   duplicate transaction/artifact, reward capacity, review, claim, expiry and
   close/refund. Record finality, successful execution and actual validator votes.
4. Validate `deploy/v2.6-bradbury-verification.json`, then promote the address,
   rubric, review mappings and release artifact together. Publish the frontend
   and check it in a clean browser before sending the response below.

The public V2.3 artifact is retained while the candidate is being checked. The
candidate verifier writes to its own file, so an intermediate run cannot replace
the live release proof. An accepted transaction is not final release evidence.

The runner checkpoints the EVM hash immediately after broadcast and recovers its
GenLayer transaction on resume. Terminal consensus or execution failures stop the
run. Expired, unused campaigns may be revised by their owner; submitted campaigns
remain immutable. The expiry scenario needs the real 24-hour review timeout.

## Response draft — send only after the release procedure succeeds

Thank you for identifying the evidence-attribution and reward-capacity issues.
The updated contract addresses all three requested controls:

1. Each campaign stores an expected transaction recipient, method and task
   identifier. Validators independently decode the finalized receipt/calldata
   and compare these values, including the submitting tester's identity. These
   rules become immutable after the first accepted submission.
2. Transaction hashes and canonical immutable artifact references are consumed
   once globally at submission acceptance. Reuse across campaigns and URL query
   or fragment variants is rejected atomically.
3. Submission acceptance reserves the full reward. An otherwise valid submission
   is evaluated against its own reservation and cannot be rejected or slashed
   because earlier evaluations spent the available pool. Insufficient capacity
   rejects the submission before retaining stake or consuming evidence.

Regression coverage includes two valid submissions with zero available pool,
both review orders, claims after campaign closure, cross-campaign replay and
atomic capacity failure. SHA-256 protects artifact integrity; semantic decisions
come from independent validator review. The UI displays the consensus-committed
leader report and verified vote metadata, not invented per-validator transcripts.

Attach the new release commit, live app URL, candidate contract/deployment and
the completed Bradbury verification artifact containing the corresponding
review, replay rejection, capacity rejection and settlement transaction links.
