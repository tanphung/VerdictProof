# VerdictProof V2.5 Full-Assurance Design

## Security objective

VerdictProof settles tester stake and sponsor rewards only after GenLayer validators independently verify a finalized Bradbury transaction and the complete immutable artifact attached to the campaign. The frontend is a renderer and transaction client; it is not an authority for provenance, verdicts, explanations, or settlement.

## Threat model

V2.5 treats the following as protocol threats:

- Reusing one transaction or artifact in more than one submission.
- Assigning valid evidence to the wrong campaign, repository, recipient, method, task, deal, amount, kind, or release state.
- Supplying a GitHub-looking URL, a redirect, a valid commit-shaped string for the wrong repository, or an artifact whose declared identity differs from the GitHub API response.
- Placing acceptable evidence in an artifact prefix and contradictory evidence later in the same artifact.
- Omitting, duplicating, or inventing obligation assessments or skipping unfavorable chunks.
- Letting earlier reviews exhaust an unreserved reward pool and then slashing a later otherwise-valid submission.
- Letting nondeterministic failures settle a submission instead of leaving it pending for retry/rotation.
- Letting the frontend synthesize a validator rationale, provenance conclusion, vote count, or successful settlement.

The contract does not attempt to prove that GitHub itself is honest. GitHub's structured repository, commit, and contents APIs are the authoritative source selected for V2.5. Arbitrary HTTP and signed-HTTP evidence are deliberately unsupported.

## Trust boundaries

- GitHub API owns repository, owner, commit, path, blob, and artifact bytes.
- Bradbury RPC owns finalized transaction lifecycle, sender, recipient, and encoded calldata.
- Each GenLayer leader and protocol-selected validator independently refetches and normalizes both sources.
- The Intelligent Contract owns evidence consumption, reward reservation, verdict, expiry, payout, and refund eligibility.
- The frontend reads finalized contract state and may provide non-authoritative preflight warnings only.

## Campaign policy schema

`create_campaign` accepts one canonical JSON policy. Unknown or missing fields are rejected.

```json
{
  "schema": "VERDICTPROOF_POLICY_V1",
  "submission_deadline": 1780000000,
  "obligations": [
    {"id": "OBL-001", "text": "Create the required campaign"}
  ],
  "artifact": {
    "provider": "GITHUB",
    "auth_mode": "GITHUB_API",
    "owner": "tanphung",
    "repository": "VerdictProof",
    "path": "evidence/result.md",
    "content_type": "text/markdown"
  },
  "receipt": {
    "source_contract": "0x0000000000000000000000000000000000000000",
    "method": "release",
    "task_identifier": {"selector": "kwargs.task_identifier", "value": "TASK-001"},
    "deal": {"selector": "kwargs.deal_id", "value": "DEAL-001"},
    "recipient": {"selector": "kwargs.recipient", "value": "0x0000000000000000000000000000000000000000"},
    "amount_atto": {"selector": "kwargs.amount_atto", "value": "40000000000000000"},
    "kind": {"selector": "kwargs.kind", "value": "RELEASE"},
    "released": {"selector": "kwargs.released", "value": true}
  }
}
```

Policy constraints:

- One to eight unique obligation IDs. An ID and its text are immutable after the first accepted submission.
- Submission deadline is between one and thirty days after campaign creation.
- Receipt selectors are restricted to `args.N` and `kwargs.identifier`.
- Artifact provider/auth mode must be `GITHUB`/`GITHUB_API`.
- Only UTF-8 `.md`, `.txt`, and `.json` artifacts with their matching content type are accepted.
- Artifact bytes are capped at 4,096 bytes.

## Authenticated provenance

The contract constructs GitHub API URLs itself; users never supply an artifact URL. Repository creation/revision verifies stable structured identity fields and stores canonical owner/name, repository ID, and node ID. Submission verifies a full 40-byte commit SHA through the commit API, then fetches the configured path through the Contents API at that commit.

The stored manifest contains canonical origin, repository identity, issuer/owner, immutable commit, path, content type, byte length, Git blob SHA, full SHA-256, total chunks, and ordered chunk SHA-256 values. A 3xx response is rejected. If an HTTP client follows a redirect internally, the returned structured repository/path/blob identity and full digest must still match the campaign and declaration.

## Complete artifact review

The full decoded byte sequence is hashed before semantic review. UTF-8 text is divided on code-point boundaries into deterministic chunks of at most 1,024 encoded bytes. Concatenating the chunks must reproduce the original byte sequence. Every chunk is labeled with its index and digest in the LLM prompt; no prefix truncation is permitted.

The LLM must return `reviewed_chunks` exactly equal to `[0..total_chunks-1]`. It must return exactly one assessment for every accepted obligation, no more and no less. Every assessment contains the obligation ID, `SATISFIED` or `VIOLATED`, evidence ID `ARTIFACT_PRIMARY`, one or more valid chunk citations, and a bounded reason code. Missing, duplicate, extra, or invalid fields are classified as `[LLM_ERROR]` and force validator rotation instead of rejecting and slashing the tester.

Approval requires valid provenance, complete chunk coverage, exact receipt gates, every obligation `SATISFIED`, and a score on the approval side of the campaign threshold. Validators compare provenance, ordered chunk digests, receipt facts, obligation verdicts, approval/threshold side, and score tolerances independently.

`task_completed` is derived from the complete obligation vector: it is true exactly when every obligation is `SATISFIED`. Receipt facts remain separate hard gates in `usage_valid` and `approved`, so a binding failure cannot create conflicting interpretations of task semantics. Proof score is derived deterministically: `40` only when every receipt gate and obligation passes, otherwise `0`. The three semantic components score tester feedback against the complete artifact using explicit discrete bands (Feedback steps of 5, Insight steps of 4, Originality steps of 3) so independent models apply the published `12/8/5/4/3` tolerance to anchored judgments rather than unconstrained integers. Citation choices and normalized reason codes must each be valid but are not required to be byte-identical; the obligation ID/verdict decision is exact.

Stable GitHub API `4xx` is classified as `[EXTERNAL]`; `408`, `429`, and a `403` explicitly reporting rate limiting are `[TRANSIENT]`. A submission/review transaction that receives the same availability error rolls back by consensus, so it cannot retain stake, consume evidence, release a reservation, or slash a tester. Operators retry only after the authoritative API becomes available; the contract never converts API availability into a semantic rejection.

## Deterministic lifecycle and accounting

- Reward capacity is reserved atomically when a submission is accepted.
- Transaction hash and canonical artifact key are consumed globally at the same transition and are never released.
- Approval consumes the reservation and makes stake plus reward claimable.
- Rejection releases the reservation, restores it to available pool, and adds the slashed stake to the pool.
- Transient/external/LLM execution errors do not mutate the pending submission or reservation.
- Every submission stores its campaign revision, submission timestamp, and deterministic review deadline.
- After the deadline, anyone may call `expire_submission`; it releases the reservation, refunds the tester stake, records `EXPIRED`, and leaves evidence consumed.
- Claim and campaign close calculate recipient and amount from contract state. Callers cannot supply alternative payout facts.
- Campaign close requires zero pending submissions and zero reserved reward. Approved but unclaimed rewards are never refundable.

## Frontend truth contract

The UI renders obligation assessments, provenance manifest, chunk coverage, exact receipt facts, reservation state, and settlement record returned by finalized contract reads. It must not generate substitute reasoning. Missing required report fields are shown as an incomplete on-chain report. Review transaction hashes are shown only after RPC verifies the contract, method, finalized lifecycle, AGREE result, and successful execution.

## Verification strategy

Direct tests cover deterministic state, parsing, canonicalization, hashing, chunks, malformed policies, reward accounting, and all adversarial cases. StudioNet integration is required for leader/validator independent refetch and LLM comparison. Bradbury deployment remains blocked until lint, direct/adversarial tests, StudioNet consensus, frontend tests, dependency audit, build, and user approval all succeed.

The mandatory adversarial matrix includes:

- valid prefix followed by a contradictory tail;
- redirect, wrong repository owner/name, unsupported auth mode, and missing provenance fields;
- binary, invalid UTF-8, unsupported content type, malformed JSON, and artifacts over 4 KiB;
- missing, reordered, or changed chunks/digests and incomplete `reviewed_chunks`;
- missing, duplicate, or invented obligation assessments and invalid evidence/chunk citations;
- correct amount paired with wrong deal, source contract, recipient, kind, release state, method, task identifier, sender, or execution lifecycle;
- canonical URL/reference variants, duplicate transaction/artifact use, and capacity exhaustion before evidence consumption;
- transient errors preserving `PENDING`/`RESERVED`, deterministic expiry refunds, approval/claim, rejection/slash, close/refund, and claim-after-close invariants;
- frontend omission behavior, exact binding display, reservation accounting, verified review-hash metadata, and the absence of synthesized rationale/provenance/settlement claims.
