# VerdictProof

VerdictProof is a GenLayer-powered product testing campaign platform where
real product evidence becomes an on-chain reward or slash verdict.

Projects create product testing campaigns and fund a small GEN reward pool.
Testers stake GEN, use the product, submit proof and written feedback, and
GenLayer AI validators decide whether the tester should receive a reward or
lose their stake.

## Live Deployment

- App: https://verdictproof.vercel.app/
- Bradbury contract: `0x2bba32a793c013BeB8742Dc17954D4dF861e5a1c`
- Explorer: https://explorer-bradbury.genlayer.com/address/0x2bba32a793c013BeB8742Dc17954D4dF861e5a1c

```text
Project funds campaign
-> Tester stakes GEN
-> Tester submits proof + feedback
-> GenLayer AI reviews usage quality
-> Reward or slash
```

## Why GenLayer Is Central

VerdictProof relies on a real Intelligent Contract because the main workflow
requires subjective, evidence-based judgment:

- read product and proof URLs;
- understand whether a tester likely used the product;
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

- the campaign product URL and task instruction;
- the tester's proof or transaction URL;
- the submitted app/result URL;
- the written feedback's specificity, usefulness, and originality;
- spam or prompt-injection risk in user-submitted text.

Each reviewed submission stores the score, approval status, evidence summary,
recommendation, and risk flags so the frontend can show a readable verdict
history instead of only a raw transaction.

## Project Structure

```text
contracts/signal_stake.py           Intelligent Contract
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

Example campaign title:

```text
Checkout QA Campaign
```

Example product URL:

```text
https://your-product.example/checkout
```

Example task:

```text
Complete checkout, capture the transaction/result URL, and report one concrete wallet confirmation issue.
```

Required proof:

```text
Transaction URL, app result URL, written feedback.
```

Default campaign values:

```text
Reward pool: 0.1 GEN
Reward per approved tester: 0.01 GEN
Stake required: 0.01 GEN
Minimum score: 75
```

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
score >= campaign.minimum_score -> APPROVED
score < campaign.minimum_score  -> REJECTED
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
genvm-lint check contracts/signal_stake.py
```

Run direct tests:

```bash
pytest tests/direct/ -v
```

Run integration smoke tests:

```bash
gltest tests/integration/ -v -s --network studionet
```

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
VITE_SIGNALSTAKE_CONTRACT_ADDRESS=<deployed-contract-address>
VITE_SIGNALSTAKE_CHAIN=bradbury
VITE_GENLAYER_EXPLORER=https://explorer-bradbury.genlayer.com
```

The `VITE_SIGNALSTAKE_*` names are retained as legacy configuration keys so
existing deployments and smoke scripts keep working after the product rename.

Without a contract address, the frontend shows a setup-required state. It does
not create local campaigns or fake submissions.

## Scope Notes

VerdictProof v1 intentionally focuses on one serious GenLayer workflow:
campaign funding, tester stake, evidence submission, Intelligent Contract
review, and reward/slash settlement. It is not a collection of many small demos
or lightly renamed examples.

Do not use `genlayernode` unless a validator setup task is explicitly requested.
