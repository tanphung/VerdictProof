# VerdictProof

VerdictProof is a GenLayer-powered product testing campaign platform where
real product evidence becomes an on-chain reward or slash verdict.

Projects create product testing campaigns and fund a small GEN reward pool.
Testers stake GEN, use the product, submit proof and written feedback, and
GenLayer validator consensus verifies the evidence before settling a reward or
slash outcome.

## Live Deployment

- App: https://verdictproof.vercel.app/
- Bradbury contract: `0x52fe4d8dA220A8b7DC63Ed2fDE9532642AAb4c7e`
- Contract explorer: https://explorer-bradbury.genlayer.com/address/0x52fe4d8dA220A8b7DC63Ed2fDE9532642AAb4c7e
- Deployment transaction: https://explorer-bradbury.genlayer.com/tx/0x5f19a0e37724476dad1478ca346613d1c696ee76d16497a51ba389e02ab72b50

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

The LLM produces the detailed four-part rubric and recommendation, but the
validator does not merely accept a correctly shaped response. It independently
re-fetches the evidence and rejects a leader verdict unless the receipt is
successful, the sender matches, the outcome URL belongs to the tested product,
the receipt contains a contract method call, and the feedback contains concrete
product-flow detail. It also verifies that the stored approval and reward match
the evidence gate and campaign threshold. This keeps the detailed review useful
without letting variable LLM wording or point allocation break consensus.

Bradbury writes request three initial validators and allow the network's three
consensus rotations. This preserves independent multi-validator judgment while
avoiding a single unavailable validator keeping a product review pending for an
entire transaction validity window.

Campaign funding and tester stake are also enforced against the exact
`gl.message.value` received by each payable method. Declared pool or stake
amounts cannot create unbacked accounting entries.

Each reviewed submission stores the three evidence gates, four rubric scores,
approval status, evidence summary, recommendation, and risk flags. The frontend
therefore shows why a verdict settled instead of only displaying an opaque AI
score or raw transaction.

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

The committed public report at
[`deploy/latest-bradbury-verification.json`](deploy/latest-bradbury-verification.json)
records a full live run against the contract above:

- two sponsor-funded campaigns;
- a wallet-owned proof approved at 90/100, with `HIGH` feedback quality and a
  real 0.04 GEN reward claimed alongside the returned 0.02 GEN stake;
- an ownership-mismatched proof rejected at 10/100 because its receipt sender
  did not match the tester wallet; its 0.02 GEN stake was slashed into the pool;
- seven Bradbury explorer links covering creation, proof submission, AI review,
  and claim transactions.

The report contains public wallet addresses, verdict fields, summaries, rubric
scores, recommendations, and explorer links only. It contains no private keys.

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

Approval rule:

```text
transaction execution succeeded
AND transaction sender matches tester
AND campaign task is proven by public evidence
AND rubric score >= campaign.minimum_score -> APPROVED

Any failed evidence gate or insufficient score -> REJECTED
```

Rejected tester stake returns to the campaign reward pool. Approved testers
claim stake return plus campaign reward through a pull-claim flow.

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
is a failed verification. It verifies one reward claim and one slash, and writes a
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
VITE_VERDICTPROOF_CONTRACT_ADDRESS=0x52fe4d8dA220A8b7DC63Ed2fDE9532642AAb4c7e
VITE_VERDICTPROOF_CHAIN=bradbury
VITE_GENLAYER_EXPLORER=https://explorer-bradbury.genlayer.com
```

The contract address is injected at build time and is never hard-coded in the
public runtime configuration file.

Without a contract address, the frontend shows a setup-required state. It does
not create local campaigns or fake submissions.

## Scope Notes

VerdictProof v1 intentionally focuses on one serious GenLayer workflow:
campaign funding, tester stake, evidence submission, Intelligent Contract
review, and reward/slash settlement. It is not a collection of many small demos
or lightly renamed examples.

Do not use `genlayernode` unless a validator setup task is explicitly requested.
