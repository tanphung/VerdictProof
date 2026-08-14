# VerdictProof V2.3 Completion Handoff

Updated: 2026-08-14 (Asia/Bangkok)

## Current release

- Workspace: `D:\app genlayer\VerdictProof`
- Repository: https://github.com/tanphung/VerdictProof
- Production: https://verdictproof.vercel.app/
- Bradbury contract: `0xF97993930eCb9e30efd77C0f2AaEE29f4d34aBed`
- Deployment tx: `0x7cb311efeef196d8fcdfae904e43cc21ab1767517453135aa11fc3b3c0a24e6a`
- Rubric: `VERDICTPROOF_V2_3`
- Source SHA-256: `5c5624351a4de6f1e79c58ce7595b7837053b03128637e7cfbf7e95776da4d33`
- Exact local/deployed source and schema match: yes
- Public artifact: `deploy/latest-bradbury-verification.json`

Never commit `.env`, `frontend/.env`, private keys, keystore passwords, or
`deploy/.bradbury-verification-state.json`.

## Final Bradbury workflow

All listed transactions are `FINALIZED / AGREE / FINISHED_WITH_RETURN`.

1. Create primary campaign:
   `0xaa2d8caa5a0297bc76531fda7547aaf33379c73572135608be4624035fcfe483`
2. Create evidence campaign:
   `0x6b342ffe43704b1790d09afd92701363f9107f0f82797a153ad7f92382674f3a`
3. Submit approved evidence:
   `0xcd649f4254ff0e87a1540b7249f19f24d57e9b1196fd11e588568024c4db233a`
4. Submit identity-mismatch evidence:
   `0xf50ef627f5ee8241ce2ca844ea83787dda7e8436a4e14ec955c0565f0a784a6d`
5. Submit semantic-mismatch evidence:
   `0xca4d10514336f1b9e91cf458ce5365507272fccffcece4d94dccfbdc020c5b87`
6. Review approved evidence (3/5 AGREE; two validator timeouts):
   `0xf125d46d87fe9679e7aebaf0bcac4162041752c2b767b760a087cde11d9995ec`
7. Review identity mismatch (3/5 AGREE; two deterministic violations):
   `0x401c6346722d4198960a1972349a84cc050b2e570b1586bd7d1b589f0a3e156d`
8. Review semantic mismatch (3/5 AGREE; two validator timeouts):
   `0xfa1d8b041c9eb8aa49cec1b10ffa5df1ae1626d7a9ec5e125add3c9b49e7a9c9`
9. Claim approved stake plus reward (5/5 AGREE):
   `0x9cf43f165be99e64061910b1e60456a77d82da4517a6373614b4bf558027d57f`
10. Close evidence campaign and refund 0.10 GEN (5/5 AGREE):
    `0x5d0bbb00018727a2308898c7421ac6014150d0171e67736491012b197b813829`

Finalized outcomes:

- Submission #1: `CLAIMED`, 88/100, receipt + identity + task passed,
  0.02 GEN stake and 0.04 GEN reward claimed.
- Submission #2: `REJECTED`, 45/100, receipt passed but wallet identity failed;
  hard-gate feedback path, 0.02 GEN stake returned to campaign pool.
- Submission #3: `REJECTED`, 44/100, receipt and wallet identity passed but
  rendered outcome did not prove the task; comparative semantic path.
- Campaign #2: `CLOSED`, 0.10 GEN refunded, remaining pool 0.

The UI must report the actual 3/5 review vote metadata. Do not present validator
timeouts or deterministic violations as `AGREE` votes.

## Verification commands

```bash
genvm-lint check contracts/verdict_proof.py --json
pytest tests/direct/ -v
gltest tests/integration/ -v -s --network studionet
cd frontend
npm test -- --run
npm audit --omit=dev
npm run build
npm run verify:bradbury
```

The verification runner is restart-safe. Existing finalized submissions may be
`CLAIMED`, and an already-closed campaign reconstructs its expected refund from
the immutable campaign creation input while still requiring the exact finalized
close transaction and `CLOSED / reward_pool=0` state.

## Submission positioning

Describe VerdictProof as a controlled public pilot with real on-chain
workflows. Do not claim external users, customers, or adoption without evidence.
The complete Project submission copy and 90-second demo sequence are in
`SUBMISSION.md`.
