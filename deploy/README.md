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
VITE_VERDICTPROOF_CONTRACT_ADDRESS=0x52fe4d8dA220A8b7DC63Ed2fDE9532642AAb4c7e
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

The current verified Bradbury deployment is
`0x52fe4d8dA220A8b7DC63Ed2fDE9532642AAb4c7e`:
https://explorer-bradbury.genlayer.com/address/0x52fe4d8dA220A8b7DC63Ed2fDE9532642AAb4c7e

For real Bradbury verification, use the three distinct funded wallets:

```powershell
npm run verify:bradbury
```

This creates two purposeful sponsor-funded campaigns, one wallet-owned valid
proof, one transaction-ownership integrity check, a detailed validator verdict
for each, and a real reward claim. A successful run requires consensus `AGREE`
plus execution `FINISHED_WITH_RETURN` and writes public addresses, verdicts, and
explorer links to `deploy\latest-bradbury-verification.json`; private keys are
never written to the report.
