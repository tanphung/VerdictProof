# Deployment and release verification

Production currently uses the historical V2.3 runtime configuration and `latest-bradbury-verification.json`. V2.6 source is a split-contract candidate. A deployed address does not prove the complete workflow.

## Checks before deployment

Use the pinned GenVM runner, lint all five contract files, run direct regressions and StudioNet integration, then frontend tests/build. On Windows:

```powershell
$env:PYTHONIOENCODING='utf-8'
$env:GENVM_VERSION='v0.3.0-rc7'
Get-ChildItem contracts/*.py | ForEach-Object { genvm-lint check $_.FullName }
python -m pytest -p no:gltest tests/direct -q
gltest tests/integration/test_verdict_proof_flow.py -q --tb=short --network studionet
```

The direct suite runs both the pre-split reference and actual split contract methods. StudioNet validates real sub-VM calls. Private keys are loaded from the ignored root `.env`; never commit them.

## V2.6 deployment order

Run these commands from `frontend/`. The selected account must match `EXPECTED_WALLET_ADDRESS`.

```powershell
foreach ($file in @('evidence_escrow','proof_provenance','proof_receipt','proof_review')) {
  $env:VERDICTPROOF_DEPLOY_CONTRACT="contracts/$file.py"
  node scripts/deploy-bradbury.mjs
  if ($LASTEXITCODE -ne 0) { throw "Deployment stopped: $file" }
}
$env:VERDICTPROOF_DEPLOY_CONTRACT='contracts/verdict_proof.py'
node scripts/deploy-bradbury.mjs
```

`VERDICTPROOF_DEPLOY_DRY_RUN=1` estimates without sending a new deployment. `VERDICTPROOF_DEPLOY_ACCEPT_ONLY=1` checkpoints acceptance without claiming finality; unset it and resume to finalize. The core requires finalized helper checkpoints with matching source hashes and fixes their addresses as constructor arguments.

The script uses `.bradbury-v26-deployments.json`. It saves the EVM hash immediately after broadcast, then the GenLayer hash/address. Resuming reuses these transactions. It refuses a changed source/signer/constructor. Do not delete or overwrite uncertain broadcast records. Gas estimates above the configured Bradbury cap stop before signing.

## Fresh evidence and scenarios

```powershell
node scripts/verify-v26.mjs <existing-full-commit-sha> prepare
```

The prepare phase creates new escrow deals and actual finalized release receipts, then writes `evidence/v2.6/`. The commit argument is not an assertion that these newly generated files already exist in that commit. Commit and push the generated fixtures before running verification. Create a second immutable commit containing the same capacity artifact to give the capacity-failure attempt an unused artifact reference.

```powershell
$env:VERDICTPROOF_V26_SECONDARY_COMMIT='<second-full-commit-sha>'
node scripts/verify-v26.mjs <primary-fixture-commit-sha> inspect
node scripts/verify-v26.mjs <primary-fixture-commit-sha> verify
```

Inspection verifies all five source/schema attestations, deployment finality, and exact helper bindings. Verification checkpoints each request and broadcast. Dependent steps may use explicit `latest-nonfinal` reads after acceptance; all transactions are finalized before writing a public progress/release report. The app uses `latest-final`.

Accepted transaction status can become visible before its state reaches the read
RPC. The runner waits for consumed references and settlement states before
continuing. Bradbury's GenLayer transaction response omits native value, so a
resumed payable write authenticates its value from the original EVM transaction,
successful receipt and matching `CreatedTransaction` identifier.

A timeout while rotating leaders is not a terminal result. Reviews can be retried
only after the prior transaction is `UNDETERMINED` or `CANCELED` with no rotations
remaining and the submission is still pending with its reservation intact. The
runner retains failed hashes, uses separate checkpoint keys and permits at most
three review transactions per case. It never recreates a submission to retry a
review.

Cases cover approval with zero available pool, a single task-identifier binding mismatch, a semantic obligation violation, cross-campaign transaction/artifact replay, atomic capacity exhaustion, claim, expiry/refund and close/refund. Expected failures must match their exact contract guard, preserve accounting, and preserve evidence availability.

Expiry requires the real 24-hour contract timeout. Before that deadline, the runner writes `v2.6-progress.json` with `workflowVerified: false` and prints the resume time. Resume with identical commit arguments; do not recreate submissions. The final artifact is `v2.6-bradbury-verification.json`.

Promote the runtime address, rubric, review mappings and final release evidence together only after all mandatory scenarios pass. Never replace the historical artifact with deployment-only or incomplete evidence.
