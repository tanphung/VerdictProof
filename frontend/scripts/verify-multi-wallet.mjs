import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseEventLogs } from "viem";
import { abi as genlayerAbi, createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const ATTO = 10n ** 18n;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXPLORER = "https://explorer-bradbury.genlayer.com";
const APP_URL = "https://verdictproof.vercel.app/";
const VERIFICATION_STATE_PATH = resolve(ROOT, "deploy", ".bradbury-verification-state.json");
const publicClient = createPublicClient({
  chain: testnetBradbury,
  transport: http(testnetBradbury.rpcUrls.default.http[0])
});

function readEnv(path) {
  const entries = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    entries[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return entries;
}

function loadVerificationState() {
  try {
    const parsed = JSON.parse(readFileSync(VERIFICATION_STATE_PATH, "utf8"));
    return {
      contractAddress: String(parsed.contractAddress ?? ""),
      transactions: typeof parsed.transactions === "object" && parsed.transactions ? parsed.transactions : {}
    };
  } catch {
    return { contractAddress: "", transactions: {} };
  }
}

function saveVerificationState(state) {
  writeFileSync(VERIFICATION_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function loadAccount(env, role, keyName, addressName) {
  const raw = env[keyName] ?? "";
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error(`${keyName} is missing or invalid`);
  }
  const account = privateKeyToAccount(key);
  const expected = String(env[addressName] ?? "").toLowerCase();
  if (!/^0x[a-fA-F0-9]{40}$/.test(expected)) {
    throw new Error(`${addressName} is missing or invalid`);
  }
  if (account.address.toLowerCase() !== expected) {
    throw new Error(`${role} private key does not match ${addressName}`);
  }
  return { role, account };
}

function gen(value) {
  return BigInt(Math.round(Number(value) * 1e6)) * (ATTO / 1_000_000n);
}

function txUrl(hash) {
  return `${EXPLORER}/tx/${hash}`;
}

function contractUrl(address) {
  return `${EXPLORER}/address/${address}`;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function writeWithRetry(label, request, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await sendContractWrite(request);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /timeout|pending|rate limit|too many|429|-32429/i.test(message);
      if (!retryable || attempt === attempts) break;
      const delayMs = 15000 * attempt;
      console.log(`${label}: transient write failure, retrying in ${delayMs / 1000}s`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function checkpointedWrite(state, key, label, request, attempts = 4) {
  const existingHash = state.transactions[key];
  if (existingHash) {
    console.log(`${label}: resuming ${existingHash}`);
    return existingHash;
  }
  const hash = await writeWithRetry(label, request, attempts);
  state.transactions[key] = hash;
  saveVerificationState(state);
  return hash;
}

async function sendContractWrite({ account, address, functionName, args = [], value = 0n }) {
  const consensusAddress = testnetBradbury.consensusMainContract?.address;
  const consensusAbi = testnetBradbury.consensusMainContract?.abi ?? [];
  const addTransaction = consensusAbi.find((entry) => entry.type === "function" && entry.name === "addTransaction");
  if (!consensusAddress || !addTransaction?.inputs) {
    throw new Error("Bradbury consensus contract configuration is unavailable");
  }

  const callData = genlayerAbi.calldata.encode(
    genlayerAbi.calldata.makeCalldataObject(functionName, args, undefined)
  );
  const transactionData = genlayerAbi.transactions.serialize([callData, false]);
  const baseArgs = [
    account.address,
    address,
    BigInt(testnetBradbury.defaultNumberOfInitialValidators ?? 5),
    BigInt(testnetBradbury.defaultConsensusMaxRotations ?? 3),
    transactionData
  ];
  const consensusArgs = addTransaction.inputs.length >= 6
    ? [...baseArgs, BigInt(Math.floor(Date.now() / 1000) + 3600)]
    : baseArgs;
  const data = encodeFunctionData({
    abi: [{ ...addTransaction, inputs: addTransaction.inputs.slice(0, consensusArgs.length) }],
    functionName: "addTransaction",
    args: consensusArgs
  });
  const estimatedGas = await publicClient.estimateGas({ account, to: consensusAddress, data, value });
  const gasPrice = await publicClient.getGasPrice();
  const walletClient = createWalletClient({ account, chain: testnetBradbury, transport: http(testnetBradbury.rpcUrls.default.http[0]) });
  const evmHash = await walletClient.sendTransaction({
    account,
    chain: testnetBradbury,
    to: consensusAddress,
    data,
    value,
    gas: estimatedGas * 2n + 100_000n,
    gasPrice,
    type: "legacy"
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: evmHash });
  if (receipt.status === "reverted") {
    throw new Error(`Bradbury EVM transaction reverted: ${evmHash}`);
  }
  const hash = extractGenlayerTxId(receipt.logs, consensusAddress);
  if (!hash) {
    throw new Error(`No GenLayer transaction id found in EVM receipt ${evmHash}`);
  }
  return hash;
}

function extractGenlayerTxId(logs, consensusAddress) {
  const createdTransactionAbi = [
    {
      anonymous: false,
      inputs: [
        { indexed: true, internalType: "bytes32", name: "txId", type: "bytes32" },
        { indexed: false, internalType: "uint256", name: "txSlot", type: "uint256" }
      ],
      name: "CreatedTransaction",
      type: "event"
    }
  ];
  try {
    const events = parseEventLogs({ abi: createdTransactionAbi, eventName: "CreatedTransaction", logs });
    const txId = events[0]?.args?.txId;
    if (typeof txId === "string") return txId;
  } catch {
    // Topic scanning below supports explorer/ABI variations.
  }

  const normalizedConsensus = consensusAddress.toLowerCase();
  for (const log of logs) {
    if (String(log.address ?? "").toLowerCase() !== normalizedConsensus) continue;
    const candidate = log.topics?.[1];
    if (
      candidate &&
      /^0x[0-9a-fA-F]{64}$/.test(candidate) &&
      !/^0x0{64}$/i.test(candidate) &&
      !/^0x0{24}[0-9a-fA-F]{40}$/i.test(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

async function waitExecuted(client, hash, label) {
  console.log(`${label}: submitted`);
  console.log(`  ${txUrl(hash)}`);
  let previousState = "";
  let consecutiveReadFailures = 0;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    let tx;
    try {
      tx = await client.getTransaction({ hash });
      consecutiveReadFailures = 0;
    } catch (error) {
      consecutiveReadFailures += 1;
      const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
      if (consecutiveReadFailures === 1) {
        console.log(`  RPC read interrupted; retrying: ${message}`);
      }
      if (consecutiveReadFailures >= 20) {
        throw new Error(`${label} could not be read after ${consecutiveReadFailures} consecutive RPC failures`);
      }
      await sleep(5000);
      continue;
    }
    const statusName = String(tx.status_name ?? tx.statusName ?? tx.status ?? "").toUpperCase();
    const resultName = String(tx.result_name ?? tx.resultName ?? "").toUpperCase();
    const executionResultName = String(tx.txExecutionResultName ?? "").toUpperCase();
    const state = `${statusName || "UNKNOWN"} / ${executionResultName || resultName || "UNKNOWN"}`;
    if (state !== previousState) {
      console.log(`  lifecycle: ${state}`);
      previousState = state;
    }

    const executionFailed = /ERROR|REVERT|FAILED/.test(executionResultName) || /ERROR|REVERT|FAILED/.test(resultName);
    const lifecycleFailed = /UNDETERMINED|CANCELED/.test(statusName);
    if (executionFailed || lifecycleFailed) {
      throw new Error(`${label} failed: ${state}`);
    }
    if (/ACCEPTED|FINALIZED/.test(statusName) && executionResultName === "FINISHED_WITH_RETURN") {
      return { hash, statusName, resultName, executionResultName };
    }
    await sleep(5000);
  }
  throw new Error(`${label} did not reach an accepted successful lifecycle state: ${previousState || "UNKNOWN"}`);
}

async function read(client, address, functionName, args = []) {
  return client.readContract({ address, functionName, args });
}

async function pollUntil(label, fn, tries = 30) {
  let lastError;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(3000);
  }
  if (lastError) throw lastError;
  throw new Error(`${label} did not appear in indexed reads`);
}

async function createCampaign(client, contractAddress, account, state, fields) {
  const hash = await checkpointedWrite(state, fields.txKey, `create ${fields.title}`, {
    account,
    address: contractAddress,
    functionName: "create_campaign",
    args: [
      fields.title,
      APP_URL,
      fields.task,
      fields.proof,
      fields.pool,
      fields.reward,
      fields.stake,
      fields.minimumScore
    ],
    value: fields.pool
  });
  const receipt = await waitExecuted(client, hash, `Create campaign: ${fields.title}`);
  const campaign = await pollUntil(fields.title, async () => {
    const listed = await read(client, contractAddress, "list_campaigns", [0n, 50n]);
    return listed.campaigns?.find((item) => item.title === fields.title);
  });
  return { campaign, receipt };
}

async function submitProof(client, contractAddress, account, state, fields) {
  const hash = await checkpointedWrite(state, fields.txKey, `submit ${fields.label}`, {
    account,
    address: contractAddress,
    functionName: "submit_proof",
    args: [fields.campaignId, fields.stake, fields.transactionUrl, fields.outcomeUrl, fields.feedback],
    value: fields.stake
  });
  const receipt = await waitExecuted(client, hash, `Submit proof: ${fields.label}`);
  const submission = await pollUntil(fields.label, async () => {
    const listed = await read(client, contractAddress, "list_campaign_submissions", [fields.campaignId]);
    return listed.submissions?.find((item) => item.tester.toLowerCase() === account.address.toLowerCase());
  });
  return { submission, receipt };
}

async function reviewSubmission(client, contractAddress, account, state, submissionId, label, txKey) {
  const hash = await checkpointedWrite(state, txKey, `review ${label}`, {
    account,
    address: contractAddress,
    functionName: "evaluate_submission",
    args: [submissionId]
  }, 2);
  const receipt = await waitExecuted(client, hash, `AI review: ${label}`);
  const submission = await pollUntil(`reviewed ${label}`, async () => {
    const item = await read(client, contractAddress, "get_submission", [submissionId]);
    return item.status !== "PENDING" ? item : null;
  }, 40);
  return { submission, receipt };
}

async function main() {
  const rootEnv = readEnv(resolve(ROOT, ".env"));
  const frontendEnv = readEnv(resolve(ROOT, "frontend", ".env"));
  const contractAddress = frontendEnv.VITE_VERDICTPROOF_CONTRACT_ADDRESS;
  if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress ?? "")) {
    throw new Error("VITE_VERDICTPROOF_CONTRACT_ADDRESS is missing or invalid in frontend/.env");
  }

  const sponsor = loadAccount(rootEnv, "Sponsor", "VERDICTPROOF_SPONSOR_PRIVATE_KEY", "VERDICTPROOF_SPONSOR_ADDRESS");
  const approvedTester = loadAccount(
    rootEnv,
    "Approved tester",
    "VERDICTPROOF_APPROVED_TESTER_PRIVATE_KEY",
    "VERDICTPROOF_APPROVED_TESTER_ADDRESS"
  );
  const rejectedTester = loadAccount(
    rootEnv,
    "Rejected tester",
    "VERDICTPROOF_REJECTED_TESTER_PRIVATE_KEY",
    "VERDICTPROOF_REJECTED_TESTER_ADDRESS"
  );
  const addresses = [sponsor.account.address, approvedTester.account.address, rejectedTester.account.address];
  if (new Set(addresses.map((address) => address.toLowerCase())).size !== addresses.length) {
    throw new Error("Sponsor and tester wallets must be distinct");
  }

  const client = createClient({ chain: testnetBradbury });
  let state = loadVerificationState();
  if (state.contractAddress.toLowerCase() !== contractAddress.toLowerCase()) {
    state = { contractAddress, transactions: {} };
  }
  saveVerificationState(state);
  const primary = await createCampaign(client, contractAddress, sponsor.account, state, {
    txKey: "createPrimaryCampaign",
    title: "First-Time Sponsor Campaign Launch Study",
    task: "Use VerdictProof to create a funded Bradbury campaign from your own tester wallet. Confirm the campaign appears in the live campaign board after finalization, then report whether wallet signing, transaction visibility, pool funding, and proof requirements are understandable.",
    proof: "Provide the Bradbury create_campaign transaction. It must be accepted or finalized with execution FINISHED_WITH_RETURN, and its sender must match the submitting tester wallet. Provide the live campaign URL and feedback citing the created campaign title, funded amount, observed result, and one actionable UX improvement.",
    pool: gen(0.25),
    reward: gen(0.04),
    stake: gen(0.02),
    minimumScore: 70n
  });
  const primaryId = BigInt(primary.campaign.campaign_id);

  const evidenceCampaign = await createCampaign(client, contractAddress, approvedTester.account, state, {
    txKey: "createEvidenceCampaign",
    title: "Verdict and Transaction Clarity Study",
    task: "Complete one VerdictProof submission lifecycle and assess whether each wallet action has a clear transaction link, pending state, final verdict, and reward or slash explanation.",
    proof: "Provide Bradbury transaction evidence accepted or finalized with FINISHED_WITH_RETURN, a public outcome URL, and feedback that identifies one specific point where settlement status could be clearer.",
    pool: gen(0.1),
    reward: gen(0.02),
    stake: gen(0.01),
    minimumScore: 70n
  });
  const evidenceCampaignId = BigInt(evidenceCampaign.campaign.campaign_id);
  const evidenceOutcomeUrl = `${APP_URL}?view=campaigns&campaign=${evidenceCampaignId}`;

  const approvedSubmission = await submitProof(client, contractAddress, approvedTester.account, state, {
    txKey: "submitApprovedEvidence",
    label: "wallet-owned campaign creation evidence",
    campaignId: primaryId,
    stake: gen(0.02),
    transactionUrl: txUrl(evidenceCampaign.receipt.hash),
    outcomeUrl: evidenceOutcomeUrl,
    feedback: `I created campaign #${evidenceCampaignId} from ${approvedTester.account.address} with a 0.10 GEN pool. The finalized transaction opens from the campaign flow and the new campaign appears on the live board with its reward, stake, and minimum score. The strongest improvement would be to show the newly created campaign ID beside the transaction link immediately after finalization so sponsors can connect the receipt to the resulting state without scanning the board.`
  });

  const rejectedSubmission = await submitProof(client, contractAddress, rejectedTester.account, state, {
    txKey: "submitRejectedEvidence",
    label: "borrowed sponsor transaction evidence",
    campaignId: primaryId,
    stake: gen(0.02),
    transactionUrl: txUrl(primary.receipt.hash),
    outcomeUrl: `${APP_URL}?view=campaigns&campaign=${primaryId}`,
    feedback: "I inspected the campaign card and its funding details, but this submission intentionally references the sponsor's create transaction instead of a transaction sent by my tester wallet. VerdictProof should reject this evidence because transaction ownership is part of the campaign requirement. A useful pre-submit improvement would be an early warning when the evidence sender differs from the connected wallet."
  });

  const approvedReview = await reviewSubmission(
    client,
    contractAddress,
    sponsor.account,
    state,
    BigInt(approvedSubmission.submission.submission_id),
    "wallet-owned evidence",
    "reviewApprovedEvidence"
  );
  if (approvedReview.submission.status !== "APPROVED") {
    throw new Error(`Expected approved evidence, received ${approvedReview.submission.status}: ${approvedReview.submission.reason_summary}`);
  }
  if (!approvedReview.submission.transaction_success || !approvedReview.submission.identity_match || !approvedReview.submission.task_completed) {
    throw new Error("Approved review did not persist all three substantive evidence checks");
  }

  const rejectedReview = await reviewSubmission(
    client,
    contractAddress,
    sponsor.account,
    state,
    BigInt(rejectedSubmission.submission.submission_id),
    "borrowed transaction evidence",
    "reviewRejectedEvidence"
  );
  if (rejectedReview.submission.status !== "REJECTED" || rejectedReview.submission.identity_match) {
    throw new Error(`Expected identity-mismatch rejection, received ${rejectedReview.submission.status}`);
  }

  const claimHash = await checkpointedWrite(state, "claimApprovedReward", "claim approved reward", {
    account: approvedTester.account,
    address: contractAddress,
    functionName: "claim_reward",
    args: [BigInt(approvedSubmission.submission.submission_id)]
  });
  const claimReceipt = await waitExecuted(client, claimHash, "Claim approved stake and reward");
  const claimed = await read(client, contractAddress, "get_submission", [BigInt(approvedSubmission.submission.submission_id)]);
  if (claimed.status !== "CLAIMED") {
    throw new Error(`Approved payout was not claimed: ${claimed.status}`);
  }

  const campaign = await read(client, contractAddress, "get_campaign", [primaryId]);
  if (Number(campaign.approved_count) !== 1 || Number(campaign.rejected_count) !== 1) {
    throw new Error("Campaign settlement counters do not reflect one approved and one rejected submission");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    network: "testnet-bradbury",
    appUrl: APP_URL,
    contractAddress,
    contractUrl: contractUrl(contractAddress),
    roles: {
      sponsor: sponsor.account.address,
      approvedTester: approvedTester.account.address,
      rejectedTester: rejectedTester.account.address
    },
    campaign: {
      campaignId: campaign.campaign_id,
      title: campaign.title,
      approvedCount: campaign.approved_count,
      rejectedCount: campaign.rejected_count,
      rewardPoolAtto: campaign.reward_pool
    },
    transactions: {
      createPrimaryCampaign: txUrl(primary.receipt.hash),
      createEvidenceCampaign: txUrl(evidenceCampaign.receipt.hash),
      submitApprovedEvidence: txUrl(approvedSubmission.receipt.hash),
      submitRejectedEvidence: txUrl(rejectedSubmission.receipt.hash),
      reviewApprovedEvidence: txUrl(approvedReview.receipt.hash),
      reviewRejectedEvidence: txUrl(rejectedReview.receipt.hash),
      claimApprovedReward: txUrl(claimReceipt.hash)
    },
    outcomes: {
      approved: claimed,
      rejected: rejectedReview.submission
    }
  };
  writeFileSync(resolve(ROOT, "deploy", "latest-bradbury-verification.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  state.completedAt = report.generatedAt;
  saveVerificationState(state);
  console.log("VerdictProof multi-wallet verification completed");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
