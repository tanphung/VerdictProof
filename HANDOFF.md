# VerdictProof Completion Handoff

Updated: 2026-07-22 (Asia/Bangkok)

## Fixed Project State

- Workspace boundary: only modify files inside `D:\app genlayer\VerdictProof`.
- Repository: `https://github.com/tanphung/VerdictProof.git`
- Production app: `https://verdictproof.vercel.app/`
- Bradbury contract: `0x629Daff64AEd536A1593930bDB3651543138dE2A`
- Contract deploy transaction: `0x84f6b0512470bb8296caaa5ecf23158d3dfb02f148f580b721c8289627dde4e4`
- Latest code checkpoint before this handoff: `ac66946`
- Never commit `.env`, `frontend/.env`, private keys, keystore passwords, or `deploy/.bradbury-verification-state.json`.

## Live Verification State

The verification script is resumable. Run it again from `frontend/`; it will reuse the saved hashes and must not submit duplicate transactions.

Successful (`ACCEPTED`, `FINISHED_WITH_RETURN`):

1. Create `First-Time Sponsor Campaign Launch Study`:
   `0xb40c0f5244e33bedcfb6f612afc2a60c25f4fe80a1b501434a6326c2365adf05`
2. Create `Verdict and Transaction Clarity Study`:
   `0x7d2e6a949d4299ea2deb62e7bf7770735981186d24f46550ca1f2de6823c611a`
3. Submit wallet-owned evidence:
   `0xdc8dbf11601277943a5ddc4f70b8c62e165b35f8584326891df2d113a511edf6`
4. Submit identity-mismatched evidence:
   `0x70b94ece460cc60aac041d0384427843d818f499086f90acfe0c699c1afffc1f`
5. AI review of wallet-owned evidence:
   `0x8bb9f4a347867ae02429fcb94184699e0b0c7c7f83b09c10f5734224ef3fc7e2`

Still in validator consensus when work paused:

- AI review of identity-mismatched evidence:
  `0xaf595bbaba7a221a25d03db8e23dd1d1cb027d1f3dc4a41e1278c0628d87e729`
- Last observed lifecycle: `COMMITTING / NOT_VOTED` after an additional consensus round.

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
