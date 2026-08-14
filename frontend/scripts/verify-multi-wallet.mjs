import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
const INITIAL_VALIDATORS = 5n;
const DEPLOYMENT_TX = "0x7cb311efeef196d8fcdfae904e43cc21ab1767517453135aa11fc3b3c0a24e6a";
const DEPLOYED_SOURCE_SHA256 = "5c5624351a4de6f1e79c58ce7595b7837053b03128637e7cfbf7e95776da4d33";
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

function assertPublicArtifactHasNoSecrets(report, env) {
  const serialized = JSON.stringify(report).toLowerCase();
  for (const [name, rawValue] of Object.entries(env)) {
    if (!/private_key|mnemonic|password|secret/i.test(name)) continue;
    const value = String(rawValue ?? "").trim().toLowerCase();
    if (!value) continue;
    const candidates = new Set([value, value.startsWith("0x") ? value.slice(2) : value]);
    for (const candidate of candidates) {
      if (candidate.length >= 12 && serialized.includes(candidate)) {
        throw new Error(`Public verification artifact contains sensitive value from ${name}`);
      }
    }
  }
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
      const retryable = /timeout|pending|rate limit|too many|429|-32429|pipeline backpressure|not currently accepting transactions|l1_sender_commit/i.test(message);
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
    INITIAL_VALIDATORS,
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
  for (let attempt = 0; attempt < 1800; attempt += 1) {
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
    const round = tx.lastRound ?? tx.consensus_data?.leader_receipt?.[0] ?? null;
    const votes = Array.isArray(round?.validatorVotesName)
      ? round.validatorVotesName.map((vote) => String(vote).toUpperCase())
      : [];
    const validatorsTotal = Math.max(votes.length, Array.isArray(round?.roundValidators) ? round.roundValidators.length : 0);
    const validatorsAgreed = votes.filter((vote) => vote === "AGREE").length;
    const rotationsLeft = Number(round?.rotationsLeft ?? 0);
    const decodedCallData = tx.txDataDecoded?.callData;
    const functionName = String(
      decodedCallData instanceof Map
        ? decodedCallData.get("method") ?? ""
        : decodedCallData && typeof decodedCallData === "object"
          ? decodedCallData.method ?? ""
          : ""
    );
    const recipient = String(tx.recipient ?? "");
    const state = `${statusName || "UNKNOWN"} / ${executionResultName || resultName || "UNKNOWN"}`;
    if (state !== previousState) {
      console.log(`  lifecycle: ${state}`);
      previousState = state;
    }

    const executionFailed = /ERROR|REVERT|FAILED/.test(executionResultName) || /ERROR|REVERT|FAILED/.test(resultName);
    const terminalLifecycle = /ACCEPTED|FINALIZED/.test(statusName);
    const consensusFailed = terminalLifecycle && resultName !== "AGREE";
    const lifecycleFailed = /UNDETERMINED|CANCELED/.test(statusName) ||
      (/TIMEOUT/.test(statusName) && rotationsLeft <= 0);
    if (executionFailed || consensusFailed || lifecycleFailed) {
      throw new Error(`${label} failed: ${state}`);
    }
    if (terminalLifecycle && resultName === "AGREE" && executionResultName === "FINISHED_WITH_RETURN") {
      return {
        hash,
        statusName,
        resultName,
        executionResultName,
        validatorsAgreed,
        validatorsTotal,
        rotationsLeft,
        validatorVotes: votes,
        recipient,
        functionName
      };
    }
    await sleep(5000);
  }
  throw new Error(`${label} did not reach an accepted successful lifecycle state: ${previousState || "UNKNOWN"}`);
}

async function finalizeWhenReady(client, account, hash, contractAddress, label) {
  const consensusAddress = testnetBradbury.consensusMainContract?.address;
  const finalizeAbi = (testnetBradbury.consensusMainContract?.abi ?? []).find(
    (entry) => entry.type === "function" && entry.name === "finalizeTransaction"
  );
  if (!consensusAddress || !finalizeAbi) {
    throw new Error("Bradbury finalizeTransaction configuration is unavailable");
  }

  let finalizationEvmHash = null;
  let finalizationAttempted = false;
  let consecutiveReadFailures = 0;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    let tx;
    try {
      tx = await client.getTransaction({ hash });
      consecutiveReadFailures = 0;
    } catch (error) {
      consecutiveReadFailures += 1;
      const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
      if (consecutiveReadFailures === 1) {
        console.log(`  finality RPC read interrupted; retrying: ${message}`);
      }
      if (consecutiveReadFailures >= 20) {
        throw new Error(`${label} finality could not be read after ${consecutiveReadFailures} RPC failures`);
      }
      await sleep(5000);
      continue;
    }
    const statusName = String(tx.statusName ?? tx.status_name ?? tx.status ?? "").toUpperCase();
    if (statusName === "FINALIZED") {
      try {
        await client.getContractCode(contractAddress);
        console.log(`${label}: finalized and contract code is readable`);
        return finalizationEvmHash;
      } catch {
        // The status can advance before the finalized state is materialized.
      }
    }
    if (statusName === "READY_TO_FINALIZE" && !finalizationAttempted) {
      finalizationAttempted = true;
      console.log(`${label}: finality window closed; submitting public finalize call`);
      const data = encodeFunctionData({
        abi: [finalizeAbi],
        functionName: "finalizeTransaction",
        args: [hash]
      });
      try {
        let gas = 200_000n;
        try {
          const estimatedGas = await publicClient.estimateGas({ account, to: consensusAddress, data });
          gas = estimatedGas * 2n + 50_000n;
        } catch {
          // The CLI also falls back to 200k when finalization estimation is unavailable.
        }
        const gasPrice = await publicClient.getGasPrice();
        const walletClient = createWalletClient({
          account,
          chain: testnetBradbury,
          transport: http(testnetBradbury.rpcUrls.default.http[0])
        });
        const evmHash = await walletClient.sendTransaction({
          account,
          chain: testnetBradbury,
          to: consensusAddress,
          data,
          gas,
          gasPrice,
          type: "legacy"
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: evmHash });
        if (receipt.status === "success") {
          console.log(`  finalization EVM transaction: ${evmHash}`);
          finalizationEvmHash = evmHash;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`  finalization deferred: ${message.split("\n")[0]}`);
        if (/backpressure|not currently accepting|rate limit|429/i.test(message)) {
          finalizationAttempted = false;
        }
        // A competing public finalizer may have won the race; re-read code/status.
      }
    }
    await sleep(5000);
  }
  throw new Error(`${label} did not become finalizable within the verification window`);
}

async function read(client, address, functionName, args = []) {
  return client.readContract({ address, functionName, args, stateStatus: "finalized" });
}

async function pollUntil(label, fn, tries = 900) {
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
  await waitExecuted(client, hash, `Create campaign: ${fields.title}`);
  await finalizeWhenReady(client, account, hash, contractAddress, `Create campaign: ${fields.title}`);
  const receipt = await waitExecuted(client, hash, `Finalized campaign: ${fields.title}`);
  if (receipt.statusName !== "FINALIZED") {
    throw new Error(`Campaign evidence ${fields.title} is not finalized`);
  }
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
  await waitExecuted(client, hash, `Submit proof: ${fields.label}`);
  await finalizeWhenReady(client, account, hash, contractAddress, `Submit proof: ${fields.label}`);
  const receipt = await waitExecuted(client, hash, `Finalized proof submission: ${fields.label}`);
  if (receipt.statusName !== "FINALIZED") {
    throw new Error(`Proof submission ${fields.label} is not finalized`);
  }
  const submission = await pollUntil(fields.label, async () => {
    const listed = await read(client, contractAddress, "list_campaign_submissions", [fields.campaignId]);
    return listed.submissions
      ?.find((item) =>
        item.tester.toLowerCase() === account.address.toLowerCase() &&
        item.transaction_url === fields.transactionUrl &&
        item.app_result_url === fields.outcomeUrl
      );
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
  await waitExecuted(client, hash, `AI review: ${label}`);
  await finalizeWhenReady(client, account, hash, contractAddress, `AI review: ${label}`);
  const receipt = await waitExecuted(client, hash, `Finalized AI review: ${label}`);
  const submission = await pollUntil(`reviewed ${label}`, async () => {
    const item = await read(client, contractAddress, "get_submission", [submissionId]);
    return item.status !== "PENDING" ? item : null;
  }, 200);
  return { submission, receipt };
}

async function closeCampaign(client, contractAddress, account, state, campaignId, label, txKey) {
  const before = await read(client, contractAddress, "get_campaign", [campaignId]);
  const hash = await checkpointedWrite(state, txKey, `close ${label}`, {
    account,
    address: contractAddress,
    functionName: "close_campaign",
    args: [campaignId]
  });
  await waitExecuted(client, hash, `Close and refund: ${label}`);
  await finalizeWhenReady(client, account, hash, contractAddress, `Close and refund: ${label}`);
  const receipt = await waitExecuted(client, hash, `Finalized close and refund: ${label}`);
  const campaign = await pollUntil(`closed ${label}`, async () => {
    const item = await read(client, contractAddress, "get_campaign", [campaignId]);
    return item.status === "CLOSED" && BigInt(item.reward_pool) === 0n ? item : null;
  });
  return { before, campaign, receipt };
}

function assertV3Report(submission, label, expectedValidationMethod) {
  const requiredTextFields = [
    "rubric_version",
    "validation_method",
    "transaction_analysis",
    "identity_analysis",
    "task_analysis",
    "proof_reason",
    "feedback_reason",
    "insight_reason",
    "originality_reason",
    "consensus_checks",
    "settlement_explanation"
  ];
  for (const field of requiredTextFields) {
    if (!String(submission[field] ?? "").trim()) {
      throw new Error(`${label} is missing detailed report field ${field}`);
    }
  }
  if (submission.rubric_version !== "VERDICTPROOF_V2_3") {
    throw new Error(`${label} used unexpected rubric ${submission.rubric_version}`);
  }
  if (submission.validation_method !== expectedValidationMethod) {
    throw new Error(`${label} used ${submission.validation_method}, expected ${expectedValidationMethod}`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

async function verifyDeploymentMatchesLocal(client, contractAddress) {
  const localSource = readFileSync(resolve(ROOT, "contracts", "verdict_proof.py"), "utf8");
  const localSha256 = createHash("sha256").update(localSource).digest("hex");
  if (localSha256 !== DEPLOYED_SOURCE_SHA256) {
    throw new Error(`Local source SHA ${localSha256} does not match pinned deployment SHA ${DEPLOYED_SOURCE_SHA256}`);
  }
  const [deployedSource, localSchema, deployedSchema] = await Promise.all([
    client.getContractCode(contractAddress),
    client.getContractSchemaForCode(localSource),
    client.getContractSchema(contractAddress)
  ]);
  const deployedSha256 = createHash("sha256").update(deployedSource).digest("hex");
  if (deployedSource !== localSource || deployedSha256 !== localSha256) {
    throw new Error(`Deployed source SHA ${deployedSha256} does not exactly match local source SHA ${localSha256}`);
  }
  if (JSON.stringify(canonicalJson(localSchema)) !== JSON.stringify(canonicalJson(deployedSchema))) {
    throw new Error("Deployed schema does not match schema generated from local source");
  }
  return { localSha256, deployedSha256, sourceExact: true, schemaExact: true };
}

function assertVerifiedReviewReceipt(receipt, contractAddress, label) {
  if (
    receipt.resultName !== "AGREE" ||
    receipt.executionResultName !== "FINISHED_WITH_RETURN" ||
    receipt.recipient.toLowerCase() !== contractAddress.toLowerCase() ||
    receipt.functionName !== "evaluate_submission"
  ) {
    throw new Error(`${label} transaction metadata does not prove an evaluate_submission consensus write`);
  }
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
  const deploymentReceipt = await waitExecuted(client, DEPLOYMENT_TX, "VerdictProof V2.3 deployment");
  const deploymentFinalizationEvmTx = await finalizeWhenReady(
    client,
    sponsor.account,
    DEPLOYMENT_TX,
    contractAddress,
    "VerdictProof V2.3 deployment"
  );
  const deploymentVerification = await verifyDeploymentMatchesLocal(client, contractAddress);
  const primary = await createCampaign(client, contractAddress, sponsor.account, state, {
    txKey: "createPrimaryCampaign",
    title: "First-Time Sponsor Campaign Launch Study",
    task: "Use VerdictProof to create a funded Bradbury campaign from your own tester wallet. Confirm the campaign appears in the live campaign board after finalization, then report whether wallet signing, transaction visibility, pool funding, and proof requirements are understandable.",
    proof: "Provide the finalized Bradbury create_campaign transaction from the tester wallet, the live campaign URL, funded amount, observed result, and one actionable UX improvement.",
    pool: gen(0.25), reward: gen(0.04), stake: gen(0.02), minimumScore: 70n
  });
  const primaryId = BigInt(primary.campaign.campaign_id);
  const evidenceCampaign = await createCampaign(client, contractAddress, approvedTester.account, state, {
    txKey: "createEvidenceCampaign",
    title: "Verdict and Transaction Clarity Study",
    task: "Complete one VerdictProof submission lifecycle and assess whether each wallet action has a clear transaction link, pending state, final verdict, and reward or slash explanation.",
    proof: "Provide finalized Bradbury transaction evidence, a public outcome URL, and specific feedback about settlement clarity.",
    pool: gen(0.1), reward: gen(0.02), stake: gen(0.01), minimumScore: 70n
  });
  const evidenceCampaignId = BigInt(evidenceCampaign.campaign.campaign_id);
  const evidenceOutcomeUrl = `${APP_URL}evidence/approved-campaign.html`;

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
    label: "transaction ownership integrity evidence",
    campaignId: primaryId,
    stake: gen(0.02),
    transactionUrl: txUrl(primary.receipt.hash),
    outcomeUrl: `${APP_URL}evidence/primary-campaign.html`,
    feedback: "While auditing the campaign card and its funding details, I used the campaign funding receipt as my evidence link. That receipt belongs to the sponsor rather than my connected tester wallet, so it does not prove that I completed the requested creation flow. The submission form should identify this ownership mismatch before stake is committed and explain which wallet must appear as the transaction sender."
  });

  const semanticSubmission = await submitProof(client, contractAddress, approvedTester.account, state, {
    txKey: "submitSemanticRejection",
    label: "semantic outcome mismatch evidence",
    campaignId: primaryId,
    stake: gen(0.02),
    transactionUrl: txUrl(evidenceCampaign.receipt.hash),
    outcomeUrl: `${APP_URL}evidence/semantic-mismatch.html`,
    feedback: "The Bradbury transaction is mine and finalized successfully, but this outcome URL is deliberately unrelated to VerdictProof and cannot demonstrate that the requested campaign appeared in the live board. A strong review must reject transaction-shaped evidence when the rendered product outcome does not substantiate the task, even if wallet ownership and execution are valid."
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
  assertV3Report(approvedReview.submission, "Approved review", "INDEPENDENT_COMPARATIVE");
  assertVerifiedReviewReceipt(approvedReview.receipt, contractAddress, "Approved review");

  const rejectedReview = await reviewSubmission(
    client,
    contractAddress,
    sponsor.account,
    state,
    BigInt(rejectedSubmission.submission.submission_id),
    "transaction ownership integrity evidence",
    "reviewRejectedEvidence"
  );
  if (rejectedReview.submission.status !== "REJECTED" || rejectedReview.submission.identity_match) {
    throw new Error(`Expected identity-mismatch rejection, received ${rejectedReview.submission.status}`);
  }
  assertV3Report(rejectedReview.submission, "Identity-mismatch review", "INDEPENDENT_HARD_GATE_FEEDBACK");
  assertVerifiedReviewReceipt(rejectedReview.receipt, contractAddress, "Identity-mismatch review");

  const semanticReview = await reviewSubmission(
    client,
    contractAddress,
    sponsor.account,
    state,
    BigInt(semanticSubmission.submission.submission_id),
    "semantic outcome mismatch evidence",
    "reviewSemanticRejection"
  );
  if (
    semanticReview.submission.status !== "REJECTED" ||
    !semanticReview.submission.transaction_success ||
    !semanticReview.submission.identity_match ||
    semanticReview.submission.task_completed
  ) {
    throw new Error(`Expected task-mismatch semantic rejection, received ${semanticReview.submission.status}`);
  }
  assertV3Report(semanticReview.submission, "Semantic-mismatch review", "INDEPENDENT_COMPARATIVE");
  assertVerifiedReviewReceipt(semanticReview.receipt, contractAddress, "Semantic-mismatch review");

  const claimHash = await checkpointedWrite(state, "claimApprovedReward", "claim approved reward", {
    account: approvedTester.account,
    address: contractAddress,
    functionName: "claim_reward",
    args: [BigInt(approvedSubmission.submission.submission_id)]
  });
  await waitExecuted(client, claimHash, "Claim approved stake and reward");
  await finalizeWhenReady(
    client,
    approvedTester.account,
    claimHash,
    contractAddress,
    "Claim approved stake and reward"
  );
  const claimReceipt = await waitExecuted(client, claimHash, "Finalized claim approved stake and reward");
  const claimed = await read(client, contractAddress, "get_submission", [BigInt(approvedSubmission.submission.submission_id)]);
  if (claimed.status !== "CLAIMED") {
    throw new Error(`Approved payout was not claimed: ${claimed.status}`);
  }
  assertV3Report(claimed, "Claimed approved review", "INDEPENDENT_COMPARATIVE");

  const closedEvidenceCampaign = await closeCampaign(
    client,
    contractAddress,
    approvedTester.account,
    state,
    evidenceCampaignId,
    "unused evidence campaign",
    "closeEvidenceCampaign"
  );
  if (BigInt(closedEvidenceCampaign.before.reward_pool) !== gen(0.1)) {
    throw new Error("Close/refund verification did not start from the expected 0.10 GEN pool");
  }

  const allCampaigns = await read(client, contractAddress, "list_campaigns", [0n, 50n]);
  const duplicateEvidence = allCampaigns.campaigns?.find((item) =>
    BigInt(item.campaign_id) !== evidenceCampaignId &&
    item.title === evidenceCampaign.campaign.title &&
    item.owner.toLowerCase() === approvedTester.account.address.toLowerCase() &&
    item.status === "OPEN" &&
    Number(item.submission_count) === 0
  );
  const closedDuplicateCampaign = duplicateEvidence
    ? await closeCampaign(
        client,
        contractAddress,
        approvedTester.account,
        state,
        BigInt(duplicateEvidence.campaign_id),
        "duplicate evidence campaign cleanup",
        "closeDuplicateEvidenceCampaign"
      )
    : null;

  const campaign = await read(client, contractAddress, "get_campaign", [primaryId]);
  if (Number(campaign.approved_count) !== 1 || Number(campaign.rejected_count) !== 2) {
    throw new Error("Campaign settlement counters do not reflect one approved and two rejected submissions");
  }

  const reviewTransactions = {
    [`${primaryId}-${approvedSubmission.submission.submission_id}`]: approvedReview.receipt.hash,
    [`${primaryId}-${rejectedSubmission.submission.submission_id}`]: rejectedReview.receipt.hash,
    [`${primaryId}-${semanticSubmission.submission.submission_id}`]: semanticReview.receipt.hash
  };
  const report = {
    generatedAt: new Date().toISOString(),
    network: "testnet-bradbury",
    appUrl: APP_URL,
    contractAddress,
    contractUrl: contractUrl(contractAddress),
    deployment: {
      transaction: txUrl(DEPLOYMENT_TX),
      sourceSha256: DEPLOYED_SOURCE_SHA256,
      exactLocalSourceMatch: deploymentVerification.sourceExact,
      exactLocalSchemaMatch: deploymentVerification.schemaExact,
      consensus: deploymentReceipt,
      finalizationEvmTransaction: deploymentFinalizationEvmTx
    },
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
    closedCampaign: {
      campaignId: closedEvidenceCampaign.campaign.campaign_id,
      title: closedEvidenceCampaign.campaign.title,
      status: closedEvidenceCampaign.campaign.status,
      refundedAtto: closedEvidenceCampaign.before.reward_pool,
      rewardPoolAtto: closedEvidenceCampaign.campaign.reward_pool
    },
    duplicateCampaignCleanup: closedDuplicateCampaign ? {
      campaignId: closedDuplicateCampaign.campaign.campaign_id,
      status: closedDuplicateCampaign.campaign.status,
      refundedAtto: closedDuplicateCampaign.before.reward_pool,
      transaction: txUrl(closedDuplicateCampaign.receipt.hash)
    } : null,
    reviewTransactions,
    transactions: {
      deployment: txUrl(DEPLOYMENT_TX),
      createPrimaryCampaign: txUrl(primary.receipt.hash),
      createEvidenceCampaign: txUrl(evidenceCampaign.receipt.hash),
      submitApprovedEvidence: txUrl(approvedSubmission.receipt.hash),
      submitRejectedEvidence: txUrl(rejectedSubmission.receipt.hash),
      submitSemanticRejection: txUrl(semanticSubmission.receipt.hash),
      reviewApprovedEvidence: txUrl(approvedReview.receipt.hash),
      reviewRejectedEvidence: txUrl(rejectedReview.receipt.hash),
      reviewSemanticRejection: txUrl(semanticReview.receipt.hash),
      claimApprovedReward: txUrl(claimReceipt.hash),
      closeEvidenceCampaign: txUrl(closedEvidenceCampaign.receipt.hash),
      ...(closedDuplicateCampaign ? {
        closeDuplicateEvidenceCampaign: txUrl(closedDuplicateCampaign.receipt.hash)
      } : {})
    },
    consensus: {
      reviewApprovedEvidence: approvedReview.receipt,
      reviewRejectedEvidence: rejectedReview.receipt,
      reviewSemanticRejection: semanticReview.receipt,
      claimApprovedReward: claimReceipt,
      closeEvidenceCampaign: closedEvidenceCampaign.receipt,
      ...(closedDuplicateCampaign ? {
        closeDuplicateEvidenceCampaign: closedDuplicateCampaign.receipt
      } : {})
    },
    outcomes: {
      approved: claimed,
      identityRejected: rejectedReview.submission,
      semanticRejected: semanticReview.submission
    }
  };
  assertPublicArtifactHasNoSecrets(report, env);
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
