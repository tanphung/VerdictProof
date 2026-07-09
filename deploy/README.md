# VerdictProof Deploy Notes

Deploy with the GenLayer CLI after lint and tests pass.

```bash
genvm-lint check contracts/signal_stake.py
gltest tests/direct/ -v
gltest tests/integration/ -v -s --network studionet
```

Then use the GenLayer CLI workflow for the target environment. After deploy,
set the frontend environment variable:

```bash
VITE_SIGNALSTAKE_CONTRACT_ADDRESS=<deployed-contract-address>
```

Do not use `genlayernode` for this dApp unless validator node setup is
explicitly requested.

## Bradbury deployment helper

For real Bradbury deployment, fill the local gitignored `.env` file in the
project root:

```env
ACCOUNT_PRIVATE_KEY=0x...
EXPECTED_WALLET_ADDRESS=0x...
SIGNALSTAKE_ACCOUNT_NAME=verdictproof-bradbury
SIGNALSTAKE_KEYSTORE_PASSWORD=verdictproof-local-deploy-password
```

The `SIGNALSTAKE_*` keys are retained as legacy deploy configuration names after
the VerdictProof rename. They can be reused safely for the same Bradbury wallet.

Then run:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\deploy-bradbury.ps1
```

The helper sets the GenLayer CLI network to `testnet-bradbury`, imports/uses the
account, deploys `contracts/signal_stake.py`, and writes the deployed contract
address into `frontend\.env`.

After deployment, run a real Bradbury smoke test from the frontend directory:

```powershell
npm run smoke:bradbury
```

The smoke script reads the gitignored root `.env`, signs with the local private
key, creates a real campaign, stakes proof, runs AI review, and claims when the
submission is approved. It never prints the private key.
