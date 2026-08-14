# VerdictProof — GenLayer Projects Submission

## Short description

VerdictProof is a controlled public pilot for product-testing campaigns. A
sponsor funds a GEN reward pool, testers stake GEN and submit public usage
evidence, and an Intelligent Contract asks independent GenLayer validators to
verify the finalized transaction, wallet identity, task completion, and
feedback quality before settling a reward or slash verdict.

## Why GenLayer is central

A deterministic contract can escrow funds, but it cannot decide whether a
public outcome page actually proves a product task or whether written feedback
is specific and useful. VerdictProof makes that judgment the on-chain
settlement boundary:

1. Every validator independently reads the finalized Bradbury receipt.
2. Receipt execution and tester identity are derived from objective fields.
3. For valid receipt and identity gates, every validator independently renders
   the outcome evidence and runs the same versioned semantic rubric.
4. The contract accepts the leader report only when the validators agree on the
   evidence gates, verdict, deterministic proof score, and bounded subjective
   score differences.
5. The consensus-approved result controls stake return, reward reservation,
   slashing, claiming, and campaign close/refund state.

Removing GenLayer would remove the independent evidence judgment that controls
settlement, not merely an optional AI summary.

## Links

- Live app: https://verdictproof.vercel.app/
- Source: https://github.com/tanphung/VerdictProof
- Bradbury V2.3 contract: https://explorer-bradbury.genlayer.com/address/0xF97993930eCb9e30efd77C0f2AaEE29f4d34aBed
- Deployment transaction: https://explorer-bradbury.genlayer.com/tx/0x7cb311efeef196d8fcdfae904e43cc21ab1767517453135aa11fc3b3c0a24e6a
- Public verification artifact: `deploy/latest-bradbury-verification.json`

## What the public pilot proves

The verification artifact is generated only after finalized state confirms the
complete multi-wallet workflow:

- a valid, wallet-owned evidence submission is approved;
- a receipt-sender identity mismatch is rejected by the hard-gate path;
- a same-origin but semantically insufficient outcome is rejected by the
  comparative semantic path;
- the approved tester claims returned stake plus reward;
- a campaign owner closes an eligible campaign and receives its unused pool;
- every published review hash points to this contract and the
  `evaluate_submission` method with `FINALIZED / AGREE /
  FINISHED_WITH_RETURN` metadata.

This is a controlled public pilot with real on-chain workflows. It does not
claim external users, customers, or adoption that has not been independently
demonstrated.

## Suggested 90-second demo

1. Open the live Campaigns view and show that campaign data is loaded from the
   V2.3 Bradbury contract.
2. Open the sponsor campaign and show the task, proof requirement, reward,
   stake, threshold, and finalized campaign transaction.
3. Open the approved submission's full GenLayer consensus report. Explain that
   validators independently agree on the hard gates, decision, threshold side, and score
   tolerances, while narrative fields are the consensus-committed leader report. Show all
   three hard gates, four anchored rubric components, rationales, risk flags, settlement
   explanation, five validator votes, and the verified explorer link.
4. Open the identity rejection and point out that receipt execution passed but
   the sender did not match the tester, so the outcome page was not rendered as
   task proof.
5. Open the semantic rejection and point out that receipt and identity passed,
   but the rendered page did not prove the requested campaign outcome.
6. Show the claimed approved submission and explain the pull-claim payout.
7. Show the closed evidence campaign with zero remaining pool and the finalized
   close/refund transaction.
8. End on the architecture section in the README: public evidence → independent
   validator comparison → consensus-approved report → on-chain settlement.

## Reviewer notes

- Rubric version: `VERDICTPROOF_V2_3`.
- Validation methods: `INDEPENDENT_COMPARATIVE` and
  `INDEPENDENT_HARD_GATE_FEEDBACK`.
- The report is the consensus-approved leader narrative; the UI does not invent
  per-validator transcripts.
- If an exact review transaction cannot be verified through RPC, the UI says
  “State committed by GenLayer consensus” and links only to the contract.
- The repository is MIT licensed and the public artifact contains no private
  key, mnemonic, password, or keystore data.
