# VerdictProof Completion Handoff

Updated: 2026-07-23 (Asia/Bangkok)

## Final State

- Workspace boundary: modify only `D:\app genlayer\VerdictProof`.
- Repository: `https://github.com/tanphung/VerdictProof.git`
- Production app: `https://verdictproof.vercel.app/`
- Bradbury contract: `0x52fe4d8dA220A8b7DC63Ed2fDE9532642AAb4c7e`
- Deploy transaction: `0x5f19a0e37724476dad1478ca346613d1c696ee76d16497a51ba389e02ab72b50`
- Never commit `.env`, `frontend/.env`, private keys, keystore passwords, or
  `deploy/.bradbury-verification-state.json`.

## Live Verification

`npm run verify:bradbury` completed against the final contract on 2026-07-23.
Every transaction reached consensus `AGREE` and execution
`FINISHED_WITH_RETURN`.

1. Create `First-Time Sponsor Campaign Launch Study`:
   `0x59228c12bdfd6ca03e7ab21c1f8c2bbd24087b332c7e7537d143117da1e10188`
2. Create `Verdict and Transaction Clarity Study`:
   `0x9042747e2eee2f5bbd1ce84d4e8f13a01a6b39aca0d91d4626f4458983a1e1e5`
3. Submit valid wallet-owned proof:
   `0x0c8c7fab8c9841f84b683ef2b469100eed57c5f700002119d199025ee601061e`
4. Submit identity-mismatched proof:
   `0xd13f77e3d6cd68022b3859d610ba40f93294e82b3ebb067b4335c8339281b197`
5. Review valid proof:
   `0x3aded86a3bb285d4b94fd2ae38ccc7f51e82d58b2661e66fe9a7b198a23f2e81`
6. Review mismatched proof:
   `0x41b54f24f66bd1fb2348abcebf31395882c2a247ffdcf7b012c6c8299aba713b`
7. Claim returned stake plus reward:
   `0xa7aaef4b6e4b2f1dde2f46618e6bf97ec9260154d0f4a2c8c31cd3ac97f6dd5a`

Outcome summary:

- Valid proof: `APPROVED`, score `90/100`, `HIGH` feedback quality, 0.02 GEN
  stake returned and 0.04 GEN reward claimed.
- Mismatched proof: `REJECTED`, score `10/100`, sender identity mismatch
  independently confirmed from the official Bradbury receipt, and 0.02 GEN
  stake slashed to the campaign pool.

The complete public record is in `deploy/latest-bradbury-verification.json`.

## Contract Consensus Design

`evaluate_submission` uses an LLM for a detailed, four-part rubric and a
specific recommendation. The validator independently fetches the official
Bradbury receipt and renders the public result URL. It verifies receipt success,
sender identity, result-domain ownership, a contract method call, feedback
specificity, settlement status, and reward accounting before accepting the
leader result. This is source-grounded evidence verification, not a JSON-format
check.

## Final Verification Checklist

Before a future code change or submission, rerun:

1. `genvm-lint check contracts/verdict_proof.py --json`
2. `pytest tests/direct/ -v`
3. `gltest tests/integration/ -v -s --network studionet`
4. `cd frontend && npm test -- --run`
5. `cd frontend && npm run build`
6. `cd frontend && npm audit --omit=dev`
7. Verify the production bundle embeds only the final contract address.

Do not use `genlayernode` unless validator-node setup is explicitly requested.
