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
VITE_VERDICTPROOF_CONTRACT_ADDRESS=0xDe0bf3732FaB463f5DA46D09c303a3D3d4390DA0
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

The current V2.1 Bradbury deployment is
`0xDe0bf3732FaB463f5DA46D09c303a3D3d4390DA0`:
https://explorer-bradbury.genlayer.com/address/0xDe0bf3732FaB463f5DA46D09c303a3D3d4390DA0

Its deployment transaction finalized with consensus `AGREE`, execution
`FINISHED_WITH_RETURN`, and 5/5 recorded `AGREE` votes. The deployed source and
local source have the same SHA-256
`3f18b1efc1cac4f5e428958d96922aecdea78e6f73d8bbefb65cf9fb351af22a`.
Do not call the V2.1 multi-wallet artifact complete until `gen_getContractCode`
and `gen_call` can read this address.

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
the report.
