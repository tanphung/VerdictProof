# VerdictProof

VerdictProof is a GenLayer-powered product testing campaign platform where
real product evidence becomes an on-chain reward or slash verdict.

Projects create product testing campaigns and fund a small GEN reward pool.
Testers stake GEN, use the product, submit proof and written feedback, and
GenLayer validator consensus verifies the evidence before settling a reward or
slash outcome.

## Deployment Status

- Production app (V2.3 runtime promoted after the complete verification run):
  https://verdictproof.vercel.app/
- Bradbury V2.3 contract: `0xF97993930eCb9e30efd77C0f2AaEE29f4d34aBed`
- Contract explorer: https://explorer-bradbury.genlayer.com/address/0xF97993930eCb9e30efd77C0f2AaEE29f4d34aBed
- Deployment transaction: https://explorer-bradbury.genlayer.com/tx/0x7cb311efeef196d8fcdfae904e43cc21ab1767517453135aa11fc3b3c0a24e6a
- V2.3 deployment consensus: `FINALIZED / AGREE / FINISHED_WITH_RETURN`, 5/5
  recorded validator votes.

The V2.3 source and generated schema in the deployment exactly match the local
contract (source SHA-256
`5c5624351a4de6f1e79c58ce7595b7837053b03128637e7cfbf7e95776da4d33`).
The production release is promoted from this exact verified source and schema;
deployment success alone is never treated as a complete product verification.

```text
Project funds campaign
-> Tester stakes GEN
-> Tester submits proof + feedback
-> GenLayer validators verify the evidence
-> Reward or slash
```

## Why GenLayer Is Central

VerdictProof relies on a real Intelligent Contract because the main workflow
requires subjective, evidence-based judgment:

- read the campaign brief and render submitted proof URLs;
- verify whether the tester completed the requested task;
- judge whether feedback is specific, useful, and original;
- settle a reward/slash outcome on-chain.

The contract uses GenLayer nondeterministic web rendering and LLM JSON review
inside `evaluate_submission`.

VerdictProof is not an off-chain AI helper with GenLayer attached. The
Intelligent Contract is the product's settlement layer: it reads evidence,
forms a validator-reviewed verdict, updates submission status, and controls
whether GEN stake is returned, rewarded, or slashed.

## What Validators Actually Check

The review is not a format check. A useful verdict requires the contract to
inspect real evidence and compare it to the campaign:

- the campaign product URL, task instruction, and proof requirement;
- the tester's proof or transaction URL;
- the submitted outcome evidence URL;
- whether the transaction reached a successful execution result;
- whether the transaction sender matches the submitting tester wallet;
- whether transaction and outcome evidence prove the requested task;
- the written feedback's specificity, usefulness, and originality;
- spam or prompt-injection risk in user-submitted text.

The leader and every validator independently call Bradbury's official
`gen_getTransactionReceipt` RPC method and render the public outcome URL. The
contract derives transaction success from `status`, consensus `result`, and
`txExecutionResult`, then compares the receipt sender to the submitting tester
wallet. These evidence gates are not delegated to the LLM.

The leader and each validator independently re-fetch the same evidence and run
the same compact, versioned rubric. A validator requires exact agreement on
receipt success, wallet identity, task completion, usage validity, approval,
and the deterministic proof score (40 for completed task evidence, 20 for a
valid receipt/identity pair whose outcome does not prove the task). Subjective
scores use fixed anchors. Valid evidence retains strict threshold-side and
12/5/4/3 total/feedback/insight/originality tolerances; invalid evidence has no
threshold-side ambiguity and uses bounded 24/10/8/6 tolerances. Malformed LLM
output forces disagreement and rotation instead of becoming a synthetic
rejection. The consensus-approved leader narrative becomes the final report;
VerdictProof does not invent a separate transcript for each validator.

Execution or identity failures, and outcome URLs outside the campaign product
origin, take the hard-gate path without rendering the outcome. Validators still
independently score feedback, insight, and originality with the same compact
schema, but task completion remains false and proof remains zero.

Bradbury writes request five initial validators and allow the network's three
consensus rotations. The UI reports the actual vote values returned by RPC; it
does not turn validator timeouts into fabricated `AGREE` votes.

Campaign funding and tester stake are also enforced against the exact
`gl.message.value` received by each payable method. Declared pool or stake
amounts cannot create unbacked accounting entries.

Each reviewed submission stores the three evidence gates, four rubric scores
and rationales, transaction/identity/task analyses, rubric version, comparative
validation method, approval status, evidence summary, recommendation, risk
flags, consensus checks, and settlement explanation. The frontend exposes this
as an expanded full validator report instead of only an opaque score.

The RPC and web-access behavior follows the official GenLayer documentation:
[GenLayer Node transaction receipt](https://docs.genlayer.com/api-references/genlayer-node/gen/gen_getTransactionReceipt)
and [Intelligent Contract web access](https://docs.genlayer.com/developers/intelligent-contracts/features/web-access).

## Project Structure

```text
contracts/verdict_proof.py          Intelligent Contract
tests/direct/                       Fast direct-mode contract tests
tests/integration/                  GenLayer environment smoke tests
frontend/                           Vite React dashboard
deploy/                             Deployment notes
gltest.config.yaml                  GenLayer test network config
```

## Live Product Flow

VerdictProof is designed to run as a live Bradbury dApp. The frontend reads
campaigns and submissions from the deployed Intelligent Contract; it does not
ship hardcoded campaign or submission rows in production.

One live campaign brief:

```text
First-Time Sponsor Campaign Launch Study
```

Live product URL:

```text
https://verdictproof.vercel.app/
```

Task:

```text
Create a funded Bradbury campaign from the tester wallet, verify it appears on the live board, and report whether signing, transaction visibility, pool funding, and proof requirements are understandable.
```

Required proof:

```text
An accepted Bradbury create-campaign transaction whose sender matches the tester wallet, the live campaign outcome URL, and specific written feedback.
```

Default campaign values:

```text
Reward pool: 0.1 GEN
Reward per approved tester: 0.01 GEN
Stake required: 0.01 GEN
Minimum score: 75
```

## Verified Bradbury Run

The public report at
[`deploy/latest-bradbury-verification.json`](deploy/latest-bradbury-verification.json)
records the complete V2.3 live run against
`0xF97993930eCb9e30efd77C0f2AaEE29f4d34aBed`. It includes:

- two sponsor-funded campaigns;
- a wallet-owned proof approved with all three evidence gates and a real 0.04
  GEN reward claimed alongside the returned 0.02 GEN stake;
- an ownership-mismatched proof rejected before outcome rendering;
- a wallet-owned, same-origin but semantically insufficient outcome rejected by
  comparative validation;
- the exact source/schema match, review vote and execution metadata, reward
  claim, and campaign close/refund transactions.

The report contains public wallet addresses, verdict fields, summaries, rubric
scores, recommendations, and explorer links only. It contains no private keys.

The V2.3 runner is checkpointed at
`deploy/.bradbury-verification-state.json` and will replace the public artifact
only after Bradbury exposes every required workflow result through finalized
state reads.
This prevents the repository from presenting a partial run as verified.

Good feedback example:

```text
I completed checkout, confirmed the wallet signature and result page, and noticed the confirmation screen does not restate the expected payment amount after signing.
```

Bad feedback example:

```text
Good app. Nice project. Very useful.
```

## Contract Workflow

Core methods:

- `create_campaign`
- `submit_proof`
- `evaluate_submission`
- `claim_reward`
- `close_campaign`

Approval rule:

```text
transaction execution succeeded
AND transaction sender matches tester
AND campaign task is proven by public evidence
AND rubric score >= campaign.minimum_score -> APPROVED

Any failed evidence gate or insufficient score -> REJECTED
```

Rejected tester stake returns to the campaign reward pool. Approved testers
claim stake return plus campaign reward through a pull-claim flow. Once no
submission remains pending, the campaign owner can close the campaign and
withdraw its remaining pool; already-approved claims remain payable because
their rewards were reserved when approved.

## Setup

Install Python tooling:

```bash
pip install -r requirements.txt
```

Install frontend dependencies:

```bash
cd frontend
npm install
```

## Development Commands

Lint the contract:

```bash
genvm-lint check contracts/verdict_proof.py
```

Run direct tests:

```bash
pytest tests/direct/ -v
```

Run integration smoke tests:

```bash
gltest tests/integration/ -v -s --network studionet
```

Run the real multi-wallet Bradbury verification after deploying a clean
contract and funding the three local gitignored test accounts:

```bash
cd frontend
npm run verify:bradbury
```

The verification uses distinct sponsor, approved-tester, and integrity-check
tester wallets. It requires every transaction to reach `ACCEPTED` or `FINALIZED`
with consensus result `AGREE` and execution `FINISHED_WITH_RETURN`; `NO_MAJORITY`
is a failed verification. It verifies an approval, semantic rejection, identity
rejection, reward claim, campaign close, and refund, and writes a
public transaction report to `deploy/latest-bradbury-verification.json` without
including private keys.

Run the frontend:

```bash
cd frontend
npm run dev
```

Build the frontend:

```bash
cd frontend
npm run build
```

## Frontend Environment

Copy `frontend/.env.example` to `frontend/.env` after deployment:

```bash
VITE_VERDICTPROOF_CONTRACT_ADDRESS=0xF97993930eCb9e30efd77C0f2AaEE29f4d34aBed
VITE_VERDICTPROOF_CHAIN=bradbury
VITE_GENLAYER_EXPLORER=https://explorer-bradbury.genlayer.com
```

The contract address is injected at build time and also published in
`frontend/public/config.js` so the linked production deployment can be switched
without rebuilding. Verified review hashes are published there only after RPC
confirms the contract, method, `AGREE` result, and successful execution.

Without a contract address, the frontend shows a setup-required state. It does
not create local campaigns or fake submissions.

## Scope Notes

VerdictProof V2.3 intentionally focuses on one serious GenLayer workflow:
campaign funding, tester stake, evidence submission, Intelligent Contract
review, and reward/slash settlement. It is not a collection of many small demos
or lightly renamed examples.

Do not use `genlayernode` unless a validator setup task is explicitly requested.
