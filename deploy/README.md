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
VITE_VERDICTPROOF_CONTRACT_ADDRESS=0x8B9f38f52C82a333c46f1061bE242A9A880E6b0e
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

After deployment, run a real Bradbury smoke test from the frontend directory:

```powershell
npm run smoke:bradbury
```

The smoke script reads the gitignored root `.env`, signs with the local private
key, creates a real campaign, stakes proof, requests a consensus verdict, and claims when the
submission is approved. It never prints the private key.

For the submission-quality verification, use the three distinct funded wallets:

```powershell
npm run verify:bradbury
```

This creates one sponsor-funded audit, one wallet-owned valid proof, one
transaction-ownership integrity check, a validator verdict for each, and a real
reward claim. A successful run requires consensus `AGREE` plus execution
`FINISHED_WITH_RETURN` and writes public addresses, verdicts, and explorer links
to `deploy\latest-bradbury-verification.json`; private keys are never written
to the report.
