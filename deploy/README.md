# VerdictProof Deploy Notes

Deploy with the GenLayer CLI after lint and tests pass.

```bash
genvm-lint check contracts/verdict_proof.py --json
genvm-lint check contracts/evidence_escrow.py --json
pytest tests/direct/ -v
gltest tests/integration/ -v -s --network studionet
```

Production configuration is changed only after the complete Bradbury verifier
finishes. A deployment candidate must never overwrite `frontend/.env` or
`frontend/public/config.js`.

Do not use `genlayernode` for this dApp unless validator node setup is
explicitly requested.

## Bradbury deployment helper

For real Bradbury deployment, fill the local gitignored `.env` file in the
project root:

```env
ACCOUNT_PRIVATE_KEY=0x...
EXPECTED_WALLET_ADDRESS=0x...
VERDICTPROOF_ACCOUNT_NAME=verdictproof-bradbury
VERDICTPROOF_KEYSTORE_PASSWORD=<local-keystore-password>

VERDICTPROOF_SPONSOR_PRIVATE_KEY=0x...
VERDICTPROOF_SPONSOR_ADDRESS=0x...
VERDICTPROOF_APPROVED_TESTER_PRIVATE_KEY=0x...
VERDICTPROOF_APPROVED_TESTER_ADDRESS=0x...
VERDICTPROOF_REJECTED_TESTER_PRIVATE_KEY=0x...
VERDICTPROOF_REJECTED_TESTER_ADDRESS=0x...
```

All account and wallet keys are local-only and must never be committed.

Deploy the two V2.5 contracts without changing production:

```powershell
$env:VERDICTPROOF_DEPLOY_CONTRACT='contracts/evidence_escrow.py'
node frontend/scripts/deploy-bradbury.mjs

$env:VERDICTPROOF_DEPLOY_CONTRACT='contracts/verdict_proof.py'
node frontend/scripts/deploy-bradbury.mjs
```

The helper stores only gitignored deployment checkpoints. It resumes matching
source deployments, waits for `FINALIZED`, and never edits production config.

The current V2.3 Bradbury deployment is
`0xF97993930eCb9e30efd77C0f2AaEE29f4d34aBed`:
https://explorer-bradbury.genlayer.com/address/0xF97993930eCb9e30efd77C0f2AaEE29f4d34aBed

Its deployment transaction finalized with consensus `AGREE`, execution
`FINISHED_WITH_RETURN`, and 5/5 recorded `AGREE` votes. The deployed source and
local source have the same SHA-256
`5c5624351a4de6f1e79c58ce7595b7837053b03128637e7cfbf7e95776da4d33`.
V2.3 remains the public release until V2.5 source, schema, campaign scenarios,
settlements, and clean-browser smoke tests all pass.

For real Bradbury verification, use the three distinct funded wallets:

```powershell
$env:VERDICTPROOF_V25_SECONDARY_COMMIT='<second-immutable-commit>'
npm run verify:bradbury -- <primary-immutable-commit>
```

This creates real funded escrow releases and campaigns covering full approval,
exact-binding rejection, semantic obligation rejection, duplicate transaction,
duplicate artifact, capacity exhaustion, reward claim, deterministic expiry,
and close/refund. Successful writes require `FINALIZED / AGREE /
FINISHED_WITH_RETURN`; expected atomic reverts require `FINALIZED / AGREE /
FINISHED_WITH_ERROR`. Only the completed run writes explorer links and reports to
`deploy\latest-bradbury-verification.json`; private keys are never written to
the report. Before writing, the runner also compares the serialized artifact
against every configured private key, mnemonic, password, and secret value and
aborts if any sensitive value appears.
