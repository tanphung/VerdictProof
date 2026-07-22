# VerdictProof Completion Handoff

Updated: 2026-07-22 (Asia/Bangkok)

## Fixed Project State

- Workspace boundary: only modify files inside `D:\app genlayer\VerdictProof`.
- Repository: `https://github.com/tanphung/VerdictProof.git`
- Production app: `https://verdictproof.vercel.app/`
- Bradbury contract: `0x8B9f38f52C82a333c46f1061bE242A9A880E6b0e`
- Contract deploy transaction: `0xba830da5325a0602f501a90a7940b4e0505342d90b8c4d8c5291eea603ea8463`
- Latest code checkpoint before this handoff: `ac66946`
- Never commit `.env`, `frontend/.env`, private keys, keystore passwords, or `deploy/.bradbury-verification-state.json`.

## Live Verification State

The verification script is resumable. Run it again from `frontend/`; it will reuse the saved hashes and must not submit duplicate transactions.

Successful (`ACCEPTED`, `AGREE`, `FINISHED_WITH_RETURN`) on the final contract:

1. Create `First-Time Sponsor Campaign Launch Study`:
   `0xecc40c02cac4c9488398ae46d18d77eef0c078b5f0f0a4fbe894edb9072c054a`
2. Create `Verdict and Transaction Clarity Study`:
   `0x760c748dbd931513d4f741f8323d30e050df431f6fd1f439389a4b1f5d430cb7`
3. Submit wallet-owned evidence:
   `0x9ad65c10ed886c0be6fcc2a5a3dcb5da5d4b67125cdfd07b2d889f7cff41d8bd`
4. Submit identity-mismatched evidence:
   `0x9d5e437f84a394a8fe8027aa1a4c84126b4ba1a55a4a936751624274fd948d5e`

Still in validator consensus when work paused:

- AI review of wallet-owned evidence:
  `0xd6814808eea761e53ffed840ebbe1a4106776af247c9f813ee4608b78e2f1dce`
- The explorer showed two automatic leader-timeout rotations before the active
  consensus round. Do not resend; resume the checkpointed verifier and require
  terminal `AGREE` plus `FINISHED_WITH_RETURN` before accepting the verdict.

## Resume Plan

1. Confirm the existing AI review transaction above reaches a terminal state. Do not resend it.
2. Resume `npm run verify:bradbury`; rely on the ignored checkpoint file so completed writes are reused.
3. Require the valid submission to be `APPROVED` and the identity-mismatched submission to be `REJECTED`, with detailed rubric fields and evidence summaries.
4. Complete the real claim transaction for the approved tester and verify stake return plus reward on-chain.
5. Generate and inspect `deploy/latest-bradbury-verification.json` without exposing secrets.
6. Verify production loads the final contract address and real campaign data immediately on desktop and mobile.
7. Test all public views and wallet lifecycle states in the production UI: Campaigns, Review, Dashboard, Claims, explorer links, disconnect/reconnect, pending, failure, and finalized success.
8. Fix root causes only; do not append CSS overrides or layer workaround code at file ends.
9. Run the complete quality gate:
   - GenVM lint
   - direct tests
   - full Studio integration tests
   - frontend unit tests
   - production build
10. Update README and deployment documentation with the final contract, verified workflow, real transaction evidence, and submission instructions.
11. Search the repository for old names, old contract addresses, placeholder URLs, and the retired Vercel domain.
12. Redeploy `https://verdictproof.vercel.app/`, visually verify it, commit all final changes, and push `main`.

## Submission Standard

VerdictProof is not complete merely because transactions are accepted. The final state must demonstrate that GenLayer validators read real public evidence, verify transaction outcome and wallet identity, judge task completion and feedback quality, produce a substantive rubric-backed verdict, and settle real GEN stake/reward/slash outcomes through the Intelligent Contract.
