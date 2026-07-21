import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const ATTO = 10n ** 18n;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXPLORER = "https://explorer-bradbury.genlayer.com";

function readEnv(path) {
  const entries = {};
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    entries[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return entries;
}

function requireHexPrivateKey(value) {
  const key = value?.startsWith("0x") ? value : `0x${value ?? ""}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error("ACCOUNT_PRIVATE_KEY is missing or invalid in root .env");
  }
  return key;
}

function gen(value) {
  return BigInt(Math.round(Number(value) * 1e6)) * (ATTO / 1_000_000n);
}

function txUrl(hash) {
  return `${EXPLORER}/tx/${hash}`;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function contractUrl(address) {
  return `${EXPLORER}/address/${address}`;
}

async function writeWithRetry(client, label, request, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await client.writeContract(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = message.includes("Transaction reverted") || message.includes("timeout") || message.includes("pending");
      if (!retryable || attempt === attempts - 1) {
        throw error;
      }
      const delayMs = 30000 * (attempt + 1);
      console.log(`${label}: write attempt ${attempt + 1} failed before tx hash; retrying in ${Math.round(delayMs / 1000)}s`);
      await sleep(delayMs);
    }
  }
  throw new Error(`${label} failed before tx hash`);
}

async function waitAccepted(client, hash, label) {
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 200 });
  const tx = await client.getTransaction({ hash });
  const resultName = String(tx.txExecutionResultName ?? tx.resultName ?? "").toUpperCase();
  const statusName = String(tx.status_name ?? tx.statusName ?? tx.status ?? "").toUpperCase();
  console.log(`${label}: ${hash}`);
  console.log(`  status: ${statusName || "UNKNOWN"} / ${resultName || "UNKNOWN"}`);
  console.log(`  explorer: ${txUrl(hash)}`);
  if (resultName && resultName !== "FINISHED_WITH_RETURN" && resultName.includes("ERROR")) {
    throw new Error(`${label} execution failed: ${resultName}`);
  }
  return tx;
}

async function read(client, address, functionName, args = []) {
  return client.readContract({ address, functionName, args });
}

async function pollUntil(label, fn, tries = 12) {
  for (let i = 0; i < tries; i += 1) {
    const value = await fn();
    if (value) return value;
    await sleep(3000);
  }
  throw new Error(`${label} did not appear in indexed reads`);
}

async function main() {
  const rootEnv = readEnv(resolve(ROOT, ".env"));
  const frontendEnv = readEnv(resolve(ROOT, "frontend", ".env"));
  const contractAddress = frontendEnv.VITE_VERDICTPROOF_CONTRACT_ADDRESS;
  if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress ?? "")) {
    throw new Error("VITE_VERDICTPROOF_CONTRACT_ADDRESS is missing or invalid in frontend/.env");
  }

  const account = privateKeyToAccount(requireHexPrivateKey(rootEnv.ACCOUNT_PRIVATE_KEY));
  const expected = rootEnv.EXPECTED_WALLET_ADDRESS?.toLowerCase();
  if (expected && account.address.toLowerCase() !== expected) {
    throw new Error("ACCOUNT_PRIVATE_KEY does not match EXPECTED_WALLET_ADDRESS");
  }

  const client = createClient({ chain: testnetBradbury });

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const title = `VerdictProof Live Smoke ${stamp}`;
  const pool = gen(0.1);
  const reward = gen(0.01);
  const stake = gen(0.01);

  console.log("VerdictProof Bradbury live smoke");
  console.log(`  account: ${account.address}`);
  console.log(`  contract: ${contractUrl(contractAddress)}`);

  const createHash = await writeWithRetry(client, "create_campaign", {
    account,
    address: contractAddress,
    functionName: "create_campaign",
    args: [
      title,
      "https://example.com/",
      "Open the Example Domain page, confirm the title and CTA, then report one concrete UX observation.",
      "Transaction URL, app result URL, written feedback.",
      pool,
      reward,
      stake,
      20n
    ],
    value: pool
  });
  await waitAccepted(client, createHash, "create_campaign");

  const campaign = await pollUntil("campaign", async () => {
    const listed = await read(client, contractAddress, "list_campaigns", [0n, 50n]);
    return listed.campaigns?.find((item) => item.title === title);
  });
  const campaignId = BigInt(campaign.campaign_id);
  console.log(`  campaign_id: ${campaignId.toString()}`);

  const submitHash = await writeWithRetry(client, "submit_proof", {
    account,
    address: contractAddress,
    functionName: "submit_proof",
    args: [
      campaignId,
      stake,
      "https://example.com/?tx=verdictproof-live-smoke",
      "https://example.com/?result=verdictproof-live-smoke",
      "I opened the Example Domain page, confirmed the Example Domain title and the More information link, and noticed the campaign task is easy to verify because the page has one clear action."
    ],
    value: stake
  });
  await waitAccepted(client, submitHash, "submit_proof");

  const submission = await pollUntil("submission", async () => {
    const listed = await read(client, contractAddress, "list_campaign_submissions", [campaignId]);
    return listed.submissions?.find((item) => BigInt(item.campaign_id) === campaignId);
  });
  const submissionId = BigInt(submission.submission_id);
  console.log(`  submission_id: ${submissionId.toString()}`);

  const reviewHash = await writeWithRetry(client, "evaluate_submission", {
    account,
    address: contractAddress,
    functionName: "evaluate_submission",
    args: [submissionId]
  });
  await waitAccepted(client, reviewHash, "evaluate_submission");

  const reviewed = await pollUntil("reviewed submission", async () => {
    const item = await read(client, contractAddress, "get_submission", [submissionId]);
    return item.status !== "PENDING" ? item : null;
  }, 20);
  console.log(`  review_result: ${reviewed.status} score=${reviewed.score}/100 reward=${reviewed.reward_amount}`);

  if (reviewed.status === "APPROVED") {
    const claimHash = await writeWithRetry(client, "claim_reward", {
      account,
      address: contractAddress,
      functionName: "claim_reward",
      args: [submissionId]
    });
    await waitAccepted(client, claimHash, "claim_reward");
    const claimed = await read(client, contractAddress, "get_submission", [submissionId]);
    console.log(`  claim_result: ${claimed.status}`);
  } else {
    console.log("  claim_result: skipped because submission was not approved");
  }

  const stats = await read(client, contractAddress, "get_stats");
  console.log(`  stats: campaigns=${stats.campaign_count} submissions=${stats.submission_count} pool=${stats.total_reward_pool}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
