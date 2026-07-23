# VerdictProof - Concise Codex Product Brief

## Working Directory

Local workspace path used during development:

```text
D:\app genlayer\VerdictProof
```
---

## Your Role

You are Codex acting as a senior full-stack Web3 and GenLayer dApp engineer.

First, understand the product brief below. Then create your own build plan and implement the complete GenLayer dApp.

Do not overbuild unnecessary features. Focus on a clean, complete, demo-ready v1 product.

---

# Product Name

## VerdictProof

---

# What VerdictProof Is

**VerdictProof is a GenLayer-powered product testing campaign platform.**

Projects create product testing campaigns and fund a small GEN reward pool. Testers stake a small amount of GEN to participate, use the product, then submit proof of real usage and written feedback.

GenLayer reads the submitted proof and feedback, evaluates whether the tester actually used the product and whether the feedback is useful, then decides whether the tester should receive a reward or lose their stake.

Core idea:

```text
Project funds campaign
->
Tester stakes GEN
->
Tester submits proof + feedback
->
GenLayer AI evaluates
->
Tester gets reward or loses stake
```

---

# Problem VerdictProof Solves

Web3 projects often need real users to test products, testnets, dApps, or new features.

They usually run campaigns like:

```text
Test our app
Submit a transaction
Give feedback
Earn reward
```

But many users only farm rewards:

```text
They do not really test the product
They submit generic feedback like "nice app"
They copy-paste feedback
They submit unrelated proof links
They spam low-quality submissions
```

VerdictProof fixes this by requiring testers to stake GEN before submitting. Good testers get their stake back plus reward. Spammy testers lose their stake.

---

# Why GenLayer Is Central

VerdictProof must use a real GenLayer Intelligent Contract.

A normal smart contract cannot:

```text
Read a product page
Read a transaction/result URL
Understand user feedback
Judge whether feedback is specific or generic
Decide whether the tester gave useful product insight
```

GenLayer can do this using:

```python
gl.nondet.web.render(url, mode="text")
```

to read public proof URLs, and:

```python
gl.nondet.exec_prompt(task, response_format="json")
```

to evaluate subjective quality and return structured JSON.

GenLayer is not optional in this app. It is the main workflow.

---

# Main User Roles

## 1. Project Owner

Creates a campaign and funds a small reward pool.

They provide:

```text
Campaign title
Product URL
Task instruction
Required proof description
Reward pool amount
Reward per approved tester
Stake required
Minimum approval score
```

## 2. Tester

Joins a campaign, stakes GEN, uses the product, submits proof and feedback, then waits for GenLayer review.

They submit:

```text
Transaction URL
App result URL
Feedback text
```

---

# Small GEN Amounts

Use small GEN amounts for demo.

Default values:

```text
Reward pool: 0.5 GEN
Reward per approved tester: 0.05 GEN
Stake required: 0.01 GEN
Minimum score: 75/100
```

Reward pools should generally be between:

```text
0.1 GEN and 1 GEN
```

---

# Required Product Flow

The app must support this complete flow:

```text
1. Project owner creates a campaign.
2. Project owner funds the campaign with a small GEN pool.
3. Tester opens the campaign.
4. Tester stakes GEN and submits proof + feedback.
5. Submission becomes Pending.
6. GenLayer reviews the submission.
7. Submission becomes Approved or Rejected.
8. If Approved, tester claims stake back + reward.
9. If Rejected, tester loses stake and receives no reward.
```

Rejected stake should return to the campaign reward pool.

---

# Main Screens

Keep the product simple with only these main screens:

```text
1. Campaigns
2. Campaign Detail
3. My Submissions
```

Also include a simple Create Campaign modal.

Do not build extra dashboards, landing pages, analytics, chat, appeals, social login, or complex admin systems.

---

# Screen 1 - Campaigns

Show campaign cards with:

```text
Campaign title
Product URL
Reward pool remaining
Reward per approved tester
Stake required
Minimum score
Submission count
Status
```

Include:

```text
Create Campaign
Open Campaign
```

---

# Create Campaign Modal

Fields:

```text
Campaign title
Product URL
Task instruction
Required proof description
Reward pool amount
Reward per approved tester
Stake required
Minimum score
```

Button:

```text
Create & Fund Campaign
```

---

# Screen 2 - Campaign Detail

Show campaign details:

```text
Title
Product URL
Task instruction
Required proof
Reward per approved tester
Stake required
Minimum score
Reward pool remaining
Status
```

Tester submit form:

```text
Transaction URL
App result URL
Feedback text
```

Button:

```text
Stake GEN & Submit Proof
```

Also show submissions for the campaign:

```text
Submitter
Status
Score
Reward
Reason summary
```

For pending submissions, include:

```text
Run AI Review
```

Anyone may trigger review for v1.

---

# Screen 3 - My Submissions

Show the connected wallet's submissions.

Each card should show:

```text
Campaign title
Status
Stake amount
Score
Reward amount
Reason summary
Claim button if approved
```

Approved example:

```text
Approved
Score: 87/100
Reward: 0.05 GEN
Stake returned: 0.01 GEN
Reason: The tester completed the required flow and gave specific feedback about the transaction confirmation UX.
```

Rejected example:

```text
Rejected
Score: 32/100
Reward: 0 GEN
Stake slashed: 0.01 GEN
Reason: The feedback is generic and the submitted proof does not demonstrate real product usage.
```

---

# Intelligent Contract Requirements

Create a real GenLayer Intelligent Contract for the app.

The contract should support:

```text
create_campaign
submit_proof
evaluate_submission
claim_reward
```

Campaign state should include:

```text
owner
title
product_url
task_instruction
proof_requirement
reward_pool
reward_per_approved
stake_required
minimum_score
status
```

Submission state should include:

```text
campaign_id
tester
transaction_url
app_result_url
feedback_text
stake_amount
status
score
approved
reward_amount
reason_summary
claimed
```

Submission statuses:

```text
PENDING
APPROVED
REJECTED
CLAIMED
```

---

# AI Review Logic

During `evaluate_submission`, the contract should read:

```text
Product URL
Transaction URL
App result URL
Feedback text
Campaign task instruction
```

Then use GenLayer AI to judge:

```text
Did the tester likely use the product?
Does the proof match the task?
Is the feedback specific?
Is the feedback useful?
Is it generic/spam/copy-paste?
What score should it receive?
Should the tester be approved or rejected?
```

Expected JSON result:

```json
{
  "approved": true,
  "score": 87,
  "usage_valid": true,
  "feedback_quality": "HIGH",
  "reward_amount": 0.05,
  "slash_stake": false,
  "reason_summary": "The tester completed the required flow and provided specific feedback about the transaction confirmation UX."
}
```

Approval rule:

```text
score >= minimum_score -> APPROVED
score < minimum_score -> REJECTED
```

Suggested scoring rubric:

```text
Usage proof validity: 40 points
Feedback specificity: 25 points
Product insight value: 20 points
Originality / non-spam: 15 points
```

---

# UI Style

Make the app look polished and professional.

Preferred style:

```text
Dark theme
Modern Web3 dashboard
Clean cards
Clear GEN amounts
Status badges
Simple navigation
```

Status colors:

```text
Pending: yellow/gray
Approved: green
Rejected: red
Claimed: blue/green
```

Use product references only for UI quality inspiration:

```text
GitDrip: reward pool and claim flow inspiration
Synthegret: GEN stake/slash presentation inspiration
VERIDIAN: professional GenLayer dashboard polish inspiration
```

Do not copy their product logic. VerdictProof's product flow is unique:

```text
Campaign -> tester stake -> usage proof + feedback -> AI review -> reward or slash
```

---

# Reference Campaign

Use this as the production reference campaign; do not seed demo data.

```text
Title:
First-Time Sponsor Campaign Launch Study

Product URL:
https://verdictproof.vercel.app/

Task:
Create a funded VerdictProof campaign from the tester wallet, verify it appears
on the live campaign board, and report whether signing, transaction visibility,
pool funding, and proof requirements are understandable.

Required proof:
An accepted Bradbury create-campaign transaction whose sender matches the tester
wallet, the live campaign outcome URL, and specific written feedback.

Reward pool:
0.25 GEN

Reward per approved tester:
0.04 GEN

Stake required:
0.02 GEN

Minimum score:
70
```

Good feedback example:

```text
I created campaign #2 from my tester wallet and confirmed the finalized
transaction opens from the campaign flow. The new campaign appears on the live
board with its reward, stake, and minimum score. The strongest improvement would
be to show the created campaign ID beside the transaction link after finalization
so sponsors can connect the receipt to the resulting state without scanning the
board.
```

Bad feedback example:

```text
Good app. Nice project. Very useful.
```

The AI review should approve the good feedback and reject the bad feedback.

---

# Final Instruction

Build VerdictProof as a complete GenLayer dApp v1.

Codex should create its own implementation plan before coding.

Keep the app focused on the core workflow:

```text
Create campaign
->
Fund small GEN pool
->
Tester stakes GEN
->
Submit proof + feedback
->
GenLayer AI review
->
Reward or slash
```

Do not rename the product. Do not expand the scope beyond the screens and flow above unless absolutely necessary.
