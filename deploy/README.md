# VerdictProof Deploy Notes

Deploy with the GenLayer CLI after lint and tests pass.

```bash
genvm-lint check contracts/verdict_proof.py --json
pytest tests/direct/ -v
gltest tests/integration/ -v -s --network studionet
```

Then use the GenLayer CLI workflow for the target environment. After deploy,
set the frontend environment variable:

```bash
VITE_VERDICTPROOF_CONTRACT_ADDRESS=0xF97993930eCb9e30efd77C0f2AaEE29f4d34aBed
```

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

Then run:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\deploy-bradbury.ps1
```

The helper sets the GenLayer CLI network to `testnet-bradbury`, imports/uses the
account, deploys `contracts/verdict_proof.py`, and writes the deployed contract
address into `frontend\.env`.

The current V2.3 Bradbury deployment is
`0xF97993930eCb9e30efd77C0f2AaEE29f4d34aBed`:
https://explorer-bradbury.genlayer.com/address/0xF97993930eCb9e30efd77C0f2AaEE29f4d34aBed

Its deployment transaction finalized with consensus `AGREE`, execution
`FINISHED_WITH_RETURN`, and 5/5 recorded `AGREE` votes. The deployed source and
local source have the same SHA-256
`5c5624351a4de6f1e79c58ce7595b7837053b03128637e7cfbf7e95776da4d33`.
The verification runner also requires the schema generated from local source to
exactly match the deployed schema. Do not call the V2.3 artifact complete until
the full finalized multi-wallet flow succeeds.

For real Bradbury verification, use the three distinct funded wallets:

```powershell
npm run verify:bradbury
```

This creates two purposeful sponsor-funded campaigns, one wallet-owned valid
proof, one transaction-ownership integrity rejection, one semantic outcome
rejection, a detailed validator verdict for each, a real reward claim, and a
campaign close/refund. A successful run requires consensus `AGREE` plus
execution `FINISHED_WITH_RETURN` and writes public addresses, detailed reports,
vote metadata when returned by RPC, and explorer links to
`deploy\latest-bradbury-verification.json`; private keys are never written to
the report. Before writing, the runner also compares the serialized artifact
against every configured private key, mnemonic, password, and secret value and
aborts if any sensitive value appears.
