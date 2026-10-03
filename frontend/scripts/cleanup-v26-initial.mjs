import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { privateKeyToAccount } from "viem/accounts";
import { checkpointWrite, expectedExecution, finalize } from "./verify-v26.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const checkpoint = resolve(root, "deploy/.bradbury-v26-initial-cleanup.json");
const address = "0x397743cd5A69d1895044a569249EAB21CAF6F466";
const env = Object.fromEntries(readFileSync(resolve(root, ".env"), "utf8").split(/\r?\n/)
  .map(line => line.trim()).filter(line => line && !line.startsWith("#") && line.includes("="))
  .map(line => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));
const read = (client, functionName, args = []) => client.readContract({ address, functionName, args, transactionHashVariant: "latest-nonfinal" });

async function main() {
  const raw = env.VERDICTPROOF_SPONSOR_PRIVATE_KEY;
  const account = privateKeyToAccount(raw.startsWith("0x") ? raw : `0x${raw}`);
  if (account.address.toLowerCase() !== env.VERDICTPROOF_SPONSOR_ADDRESS.toLowerCase()) throw new Error("Sponsor signer mismatch");
  const client = createClient({ chain: testnetBradbury });
  const actual = await client.getContractCode(address);
  if (actual !== readFileSync(resolve(root, "deploy/v2.6-initial-contracts/verdict_proof.py"), "utf8")) throw new Error("Initial deployed source mismatch");
  const campaigns = (await read(client, "list_campaigns", [0n, 50n])).campaigns;
  if (campaigns.length !== 8 || campaigns.some(c => c.owner.toLowerCase() !== account.address.toLowerCase() || !/^V2\.6 \w+ 20261002$/.test(c.title))) throw new Error("Unexpected initial campaign set");
  const initial = JSON.parse(readFileSync(resolve(root, "deploy/.bradbury-v26-d4bc93899cd3cb19192f518d56d76e509ae6583c-verification-state.json"), "utf8"));
  const ids = Object.values(initial.acceptedSubmissions).map(s => BigInt(s.submission_id));
  const submissions = await Promise.all(ids.map(id => read(client, "get_submission", [id])));
  if (submissions.some(s => !["PENDING", "EXPIRED"].includes(s.status))) throw new Error("Unexpected initial settlement; inspect before cleanup");
  const readyAt = Math.max(...submissions.filter(s => s.status === "PENDING").map(s => Number(s.review_deadline))) + 1;
  if (Date.now() / 1000 < readyAt) {
    console.log(`Initial cleanup must wait until ${new Date(readyAt * 1000).toISOString()}`);
    return;
  }
  const state = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, "utf8")) : { address, transactions: {} };
  if (state.address !== address) throw new Error("Cleanup checkpoint mismatch");
  state._checkpointPath = checkpoint;
  const writes = [];
  async function execute(key, functionName, args) {
    const hash = await checkpointWrite(client, state, key, key, { account, address, functionName, args });
    for (let i = 0; i < 1800; i++) {
      const tx = await client.getTransaction({ hash });
      const result = { statusName: tx.statusName, resultName: tx.resultName, executionResultName: tx.txExecutionResultName, rotationsLeft: Number(tx.lastRound?.rotationsLeft ?? 0) };
      if (expectedExecution(result)) { writes.push(hash); return; }
      await new Promise(done => setTimeout(done, 5000));
    }
    throw new Error(`${key} execution timed out; checkpoint retained`);
  }
  for (const id of ids) {
    const s = await read(client, "get_submission", [id]);
    if (s.status === "PENDING" || state.transactions[`expire:${id}`]) await execute(`expire:${id}`, "expire_submission", [id]);
  }
  for (const campaign of campaigns) {
    const id = BigInt(campaign.campaign_id);
    let c;
    for (let i = 0; i < 60; i++) {
      c = await read(client, "get_campaign", [id]);
      if (BigInt(c.reserved_reward_pool) === 0n && Number(c.submission_count) === Number(c.expired_count)) break;
      await new Promise(done => setTimeout(done, 2000));
    }
    if (BigInt(c.reserved_reward_pool) !== 0n || Number(c.submission_count) !== Number(c.expired_count)) throw new Error("Cleanup accounting has unresolved submissions");
    if (c.status === "OPEN" || state.transactions[`close:${id}`]) await execute(`close:${id}`, "close_campaign", [id]);
  }
  const finalTransactions = [];
  for (const hash of writes) finalTransactions.push(await finalize(client, account, hash, "Initial cleanup"));
  const finalCampaigns = [];
  for (const c of campaigns) {
    const row = await client.readContract({ address, functionName: "get_campaign", args: [BigInt(c.campaign_id)], transactionHashVariant: "latest-final" });
    if (row.status !== "CLOSED" || BigInt(row.reward_pool) !== 0n || BigInt(row.reserved_reward_pool) !== 0n) throw new Error("Initial cleanup is not finalized");
    finalCampaigns.push(row);
  }
  writeFileSync(resolve(root, "deploy/v2.6-initial-cleanup.json"), JSON.stringify({ generatedAt: new Date().toISOString(), address, finalCampaigns, finalTransactions }, null, 2));
  console.log("Initial revision refunds and campaign closure finalized.");
}
main().catch(error => { console.error(String(error?.shortMessage ?? error?.message ?? error).split("\n")[0]); process.exitCode = 1; });
