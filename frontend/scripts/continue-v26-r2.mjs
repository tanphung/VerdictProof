// Continue this one release after the already-broadcast deployments/receipts
// finalize. This does not schedule later runs or bypass the real expiry timeout.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const frontend = resolve(root, "frontend");
const releaseFile = resolve(root, "deploy/.bradbury-v26-r2-artifact-commits.json");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const load = path => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
const pause = ms => new Promise(done => setTimeout(done, ms));
const environment = { ...process.env, VERDICTPROOF_RELEASE_REVISION: "r2" };
async function run(args, env = environment) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { cwd: frontend, env, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? done() : reject(new Error(`Release step exited ${code}`)));
  });
}
async function main() {
  if (git("branch", "--show-current") !== "fix/steward-remediation-20260925") throw new Error("Unexpected release branch");
  let deployments, preflight;
  const limit = Date.now() + 4 * 3600_000;
  for (;;) {
    deployments = load(resolve(root, "deploy/.bradbury-v26-r2-deployments.json"))?.deployments;
    preflight = load(resolve(root, "deploy/.bradbury-v26-r2-preflight-state.json"));
    const names = ["evidence_escrow", "proof_provenance", "proof_receipt", "proof_review", "verdict_proof"];
    const deployed = names.every(name => deployments?.[`contracts/${name}.py`]?.status === "FINALIZED");
    const receipts = preflight?.evidence && Object.keys(preflight.evidence).length === 9 && Object.values(preflight.evidence).every(tx => tx.statusName === "FINALIZED");
    const fixture = resolve(root, "evidence/v2.6/steward-approved.md");
    const generated = receipts && existsSync(fixture) && readFileSync(fixture, "utf8").includes(preflight.evidence.approved.hash);
    if (deployed && generated) break;
    if (Date.now() > limit) throw new Error("Release prerequisites did not finalize within four hours; checkpoints retained");
    await pause(15000);
  }
  let commits = load(releaseFile) ?? {};
  const save = () => writeFileSync(releaseFile, JSON.stringify(commits, null, 2));
  if (!commits.primary) {
    writeFileSync(resolve(root, "evidence/v2.6/README.md"),
      `# V2.6 revision r2 evidence\n\nFresh finalized escrow receipts for release ${preflight.releaseId}.\n` +
      `Settlement core: ${deployments["contracts/verdict_proof.py"].contractAddress}.\n\n` +
      "The fixture definitions are not a claim that reviews or payouts have already succeeded.\n");
    git("add", "evidence/v2.6");
    git("commit", "-m", "Commit fresh finalized r2 evidence fixtures");
    commits.primary = git("rev-parse", "HEAD");
    save();
  }
  git("push", "origin", "fix/steward-remediation-20260925");
  if (!commits.secondary) {
    writeFileSync(resolve(root, "evidence/v2.6/README.md"),
      readFileSync(resolve(root, "evidence/v2.6/README.md"), "utf8") +
      `\nPrimary artifact commit: ${commits.primary}.\n\n` +
      "This second immutable reference preserves capacity.md byte-for-byte. Its unused reference and transaction prove capacity rejection does not consume evidence.\n");
    git("add", "evidence/v2.6/README.md");
    git("commit", "-m", "Record distinct immutable r2 capacity reference");
    commits.secondary = git("rev-parse", "HEAD");
    save();
  }
  git("push", "origin", "fix/steward-remediation-20260925");
  if (git("show", `${commits.primary}:evidence/v2.6/capacity.md`) !== git("show", `${commits.secondary}:evidence/v2.6/capacity.md`)) throw new Error("Secondary capacity artifact differs");
  const env = { ...environment, VERDICTPROOF_V26_SECONDARY_COMMIT: commits.secondary };
  await run(["scripts/verify-v26.mjs", commits.primary, "inspect"], env);
  await run(["scripts/verify-v26.mjs", commits.primary, "verify"], env);
  console.log(`Release checkpoint reached. Resume with revision=r2, primary=${commits.primary}, secondary=${commits.secondary}. Check the reported real expiry deadline before final settlement.`);
}
main().catch(error => { console.error(String(error?.message ?? error).split("\n")[0]); process.exitCode = 1; });
