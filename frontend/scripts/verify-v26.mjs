import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseEventLogs } from "viem";
import { abi as genlayerAbi, createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXPLORER = "https://explorer-bradbury.genlayer.com";
const APP_URL = "https://verdictproof.vercel.app/";
const ATTO = 10n ** 18n;
const INITIAL_VALIDATORS = 5n;
const RUBRIC = "VERDICTPROOF_V2_6_STEWARD_REMEDIATION";
const ARTIFACT_COMMIT = String(process.argv[2] ?? "").toLowerCase();
const LEGACY_STATE_PATH = resolve(ROOT, "deploy", ".bradbury-v26-verification-state.json");
const STATE_PATH = existsSync(LEGACY_STATE_PATH) && JSON.parse(readFileSync(LEGACY_STATE_PATH, "utf8")).artifactCommit === ARTIFACT_COMMIT
  ? LEGACY_STATE_PATH : resolve(ROOT, "deploy", `.bradbury-v26-${ARTIFACT_COMMIT}-verification-state.json`);
const PREFLIGHT_STATE_PATH = resolve(ROOT, "deploy", ".bradbury-v26-preflight-state.json");
const DEPLOYMENTS_PATH = resolve(ROOT, "deploy", ".bradbury-v26-deployments.json");
const PUBLIC_ARTIFACT = resolve(ROOT, "deploy", "v2.6-bradbury-verification.json");
const MODE = String(process.argv[3] ?? "verify");
const pendingWrites = [];
const SECONDARY_COMMIT = String(process.env.VERDICTPROOF_V26_SECONDARY_COMMIT ?? "").toLowerCase();

const publicClient = createPublicClient({
  chain: testnetBradbury,
  transport: http(testnetBradbury.rpcUrls.default.http[0], { timeout: 120_000, retryCount: 1 })
});

function envFile(path) {
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith("#") || !value.includes("=")) continue;
    const index = value.indexOf("=");
    values[value.slice(0, index).trim()] = value.slice(index + 1).trim();
  }
  return values;
}

function account(env, role, keyName, addressName) {
  const raw = String(env[keyName] ?? "");
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${keyName} is missing or invalid`);
  const value = privateKeyToAccount(key);
  if (value.address.toLowerCase() !== String(env[addressName] ?? "").toLowerCase()) {
    throw new Error(`${role} key does not match ${addressName}`);
  }
  return value;
}

function loadJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

function saveState(state) {
  const target = state._checkpointPath ?? STATE_PATH;
  const persisted = { ...state };
  delete persisted._checkpointPath;
  writeFileSync(target, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
}

function sleep(ms) { return new Promise((done) => setTimeout(done, ms)); }
function gen(value) { return BigInt(Math.round(value * 1_000_000)) * (ATTO / 1_000_000n); }
function txUrl(hash) { return `${EXPLORER}/tx/${hash}`; }
function addressUrl(address) { return `${EXPLORER}/address/${address}`; }
function compact(value) { return JSON.stringify(value); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !(value instanceof Map)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
function normalized(value) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && value.startsWith("0x")) return value.toLowerCase();
  if (Array.isArray(value)) return value.map(normalized);
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, item]) => [key, normalized(item)]));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalized(item)]));
  return value;
}

function callDetails(tx) {
  const call = tx.txDataDecoded?.callData;
  const item = call instanceof Map ? Object.fromEntries(call) : call ?? {};
  return { method: String(item.method ?? ""), args: normalized(item.args ?? []) };
}

function extractGenlayerTxId(logs, consensusAddress) {
  const abi = [{ anonymous: false, inputs: [
    { indexed: true, internalType: "bytes32", name: "txId", type: "bytes32" },
    { indexed: false, internalType: "uint256", name: "txSlot", type: "uint256" }
  ], name: "CreatedTransaction", type: "event" }];
  try {
    const events = parseEventLogs({ abi, eventName: "CreatedTransaction", logs });
    if (typeof events[0]?.args?.txId === "string") return events[0].args.txId;
  } catch { /* topic fallback below */ }
  for (const log of logs) {
    if (String(log.address).toLowerCase() !== consensusAddress.toLowerCase()) continue;
    const candidate = log.topics?.[1];
    if (/^0x[0-9a-fA-F]{64}$/.test(candidate ?? "")) return candidate;
  }
  throw new Error("CreatedTransaction event did not expose a GenLayer transaction id");
}

async function sendWrite(request, onBroadcast, priorEvmHash) {
  const consensusAddress = testnetBradbury.consensusMainContract?.address;
  const consensusAbi = testnetBradbury.consensusMainContract?.abi ?? [];
  const add = consensusAbi.find((entry) => entry.type === "function" && entry.name === "addTransaction");
  if (!consensusAddress || !add?.inputs) throw new Error("Bradbury addTransaction ABI is unavailable");
  const calldata = genlayerAbi.calldata.encode(genlayerAbi.calldata.makeCalldataObject(request.functionName, request.args ?? [], undefined));
  const transactionData = genlayerAbi.transactions.serialize([calldata, false]);
  const base = [request.account.address, request.address, INITIAL_VALIDATORS, BigInt(testnetBradbury.defaultConsensusMaxRotations ?? 3), transactionData];
  const args = add.inputs.length >= 6 ? [...base, BigInt(Math.floor(Date.now() / 1000) + 3600)] : base;
  const data = encodeFunctionData({ abi: [{ ...add, inputs: add.inputs.slice(0, args.length) }], functionName: "addTransaction", args });
  let evmHash = priorEvmHash;
  if (!evmHash) {
    const gas = await publicClient.estimateGas({ account: request.account, to: consensusAddress, data, value: request.value ?? 0n });
    const wallet = createWalletClient({ account: request.account, chain: testnetBradbury, transport: http(testnetBradbury.rpcUrls.default.http[0], { retryCount: 0 }) });
    evmHash = await wallet.sendTransaction({ account: request.account, chain: testnetBradbury, to: consensusAddress, data, value: request.value ?? 0n, gas: gas * 2n + 100_000n, gasPrice: await publicClient.getGasPrice(), type: "legacy" });
    onBroadcast(evmHash);
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash: evmHash });
  if (receipt.status !== "success") throw new Error(`Bradbury EVM write reverted: ${evmHash}`);
  return extractGenlayerTxId(receipt.logs, consensusAddress);
}

export async function checkpointWrite(client, state, key, label, request, broadcast = sendWrite) {
  state.evmTransactions ??= {};
  state.writeRequests ??= {};
  const identity = compact(normalized({ sender: request.account.address, address: request.address,
    method: request.functionName, args: request.args ?? [], value: request.value ?? 0n }));
  if (state.writeRequests[key] && state.writeRequests[key] !== identity) throw new Error(`${label} write request changed since checkpoint`);
  const existing = state.transactions[key];
  if (existing) {
    const tx = await client.getTransaction({ hash: existing });
    const call = callDetails(tx);
    let transferredValue = tx.value;
    if (transferredValue === undefined || transferredValue === null) {
      const evmHash = state.evmTransactions[key];
      if (!evmHash) throw new Error(`${label} lacks an EVM checkpoint for native value verification`);
      const [evmTx, evmReceipt] = await Promise.all([
        publicClient.getTransaction({ hash: evmHash }), publicClient.getTransactionReceipt({ hash: evmHash })
      ]);
      if (evmReceipt.status !== "success" || evmTx.from.toLowerCase() !== request.account.address.toLowerCase() ||
          String(evmTx.to).toLowerCase() !== testnetBradbury.consensusMainContract.address.toLowerCase() ||
          extractGenlayerTxId(evmReceipt.logs, testnetBradbury.consensusMainContract.address).toLowerCase() !== existing.toLowerCase()) {
        throw new Error(`${label} EVM checkpoint does not authenticate this GenLayer transaction`);
      }
      transferredValue = evmTx.value;
    }
    if (String(tx.recipient).toLowerCase() !== request.address.toLowerCase() ||
        String(tx.sender ?? tx.from_address ?? "").toLowerCase() !== request.account.address.toLowerCase() ||
        BigInt(transferredValue) !== BigInt(request.value ?? 0) ||
        call.method !== request.functionName || compact(call.args) !== compact(normalized(request.args ?? []))) {
      throw new Error(`${label} checkpoint does not match exact sender, value, recipient, method, and calldata`);
    }
    console.log(`${label}: resuming ${existing}`);
    return existing;
  }
  state.writeRequests[key] = identity;
  saveState(state);
  // Never resubmit an uncertain broadcast. Persist the EVM hash before waiting
  // for a receipt; a resumed run recovers the original GenLayer transaction.
  const hash = await broadcast(request, (evmHash) => {
    state.evmTransactions[key] = evmHash;
    saveState(state);
  }, state.evmTransactions[key]);
  state.transactions[key] = hash;
  saveState(state);
  return hash;
}

export function expectedExecution(record, expectError = false) {
  const terminal = ["ACCEPTED", "READY_TO_FINALIZE", "FINALIZED"].includes(record.statusName);
  if (!terminal) {
    if (/DISAGREE|UNDETERMINED|CANCELED|TIMEOUT/.test(`${record.resultName}/${record.statusName}`) && Number(record.rotationsLeft ?? 0) === 0) {
      throw new Error(`failed consensus: ${record.statusName}/${record.resultName}`);
    }
    return false;
  }
  if (record.resultName !== "AGREE") throw new Error(`failed consensus: ${record.statusName}/${record.resultName}`);
  const failed = /ERROR|REVERT|FAILED/.test(record.executionResultName);
  if (expectError && failed) return true;
  if (!expectError && record.executionResultName === "FINISHED_WITH_RETURN") return true;
  throw new Error(`unexpected execution result: ${record.executionResultName}`);
}

function snapshot(tx, hash) {
  const statusName = String(tx.statusName ?? tx.status_name ?? tx.status ?? "").toUpperCase();
  const resultName = String(tx.resultName ?? tx.result_name ?? "").toUpperCase();
  const executionResultName = String(tx.txExecutionResultName ?? "").toUpperCase();
  const round = tx.lastRound ?? {};
  const votes = Array.isArray(round.validatorVotesName) ? round.validatorVotesName.map((vote) => String(vote).toUpperCase()) : [];
  const call = callDetails(tx);
  return {
    hash, statusName, resultName, executionResultName,
    validatorsAgreed: votes.filter((vote) => vote === "AGREE").length,
    validatorsTotal: Math.max(votes.length, Array.isArray(round.roundValidators) ? round.roundValidators.length : 0),
    validatorVotes: votes,
    rotationsLeft: Number(round.rotationsLeft ?? 0),
    recipient: String(tx.recipient ?? ""), functionName: call.method, args: call.args
  };
}

async function waitResult(client, hash, label, expectError = false) {
  console.log(`${label}: ${txUrl(hash)}`);
  let last = "";
  for (let attempt = 0; attempt < 1800; attempt += 1) {
    try {
      const tx = await client.getTransaction({ hash });
      const record = snapshot(tx, hash);
      const stage = `${record.statusName}/${record.resultName}/${record.executionResultName}`;
      if (stage !== last) { console.log(`  ${stage}`); last = stage; }
      if (expectedExecution(record, expectError)) return record;
    } catch (error) {
      if (!/timeout|429|rate limit|fetch failed|network|capacity|backpressure/i.test(String(error?.message ?? error)) || /failed consensus|unexpected execution result/.test(String(error?.message ?? error))) throw error;
    }
    await sleep(5000);
  }
  throw new Error(`${label} did not reach its expected result: ${last}`);
}

async function finalize(client, accountValue, hash, label) {
  const consensusAddress = testnetBradbury.consensusMainContract?.address;
  const finalizeAbi = (testnetBradbury.consensusMainContract?.abi ?? []).find((entry) => entry.type === "function" && entry.name === "finalizeTransaction");
  if (!consensusAddress || !finalizeAbi) throw new Error("Bradbury finalize ABI unavailable");
  for (let attempt = 0; attempt < 900; attempt += 1) {
    let tx;
    try {
      tx = await client.getTransaction({ hash });
    } catch (error) {
      if (!/timeout|429|rate limit|fetch failed|network|capacity|backpressure/i.test(String(error?.message ?? error))) throw error;
      await sleep(5000);
      continue;
    }
    const status = String(tx.statusName ?? tx.status_name ?? tx.status ?? "").toUpperCase();
    if (status === "FINALIZED") return snapshot(tx, hash);
    if (status === "READY_TO_FINALIZE") {
      const data = encodeFunctionData({ abi: [finalizeAbi], functionName: "finalizeTransaction", args: [hash] });
      try {
        const wallet = createWalletClient({ account: accountValue, chain: testnetBradbury, transport: http(testnetBradbury.rpcUrls.default.http[0]) });
        const evmHash = await wallet.sendTransaction({ account: accountValue, chain: testnetBradbury, to: consensusAddress, data, gas: 300_000n, gasPrice: await publicClient.getGasPrice(), type: "legacy" });
        await publicClient.waitForTransactionReceipt({ hash: evmHash });
      } catch (error) {
        if (!/already|finaliz|capacity|backpressure|rate/i.test(String(error?.message ?? error))) throw error;
      }
    }
    await sleep(5000);
  }
  throw new Error(`${label} did not finalize`);
}

async function acceptWrite(client, state, key, label, request, expectError = false) {
  const hash = await checkpointWrite(client, state, key, label, request);
  const record = await waitResult(client, hash, label, expectError);
  return { record, request, expectError, label };
}

async function settleWrite(client, accepted) {
  const { record: acceptedRecord, request, expectError, label } = accepted;
  const finalRecord = await finalize(client, request.account, acceptedRecord.hash, label);
  if (finalRecord.statusName !== "FINALIZED" || finalRecord.resultName !== "AGREE") throw new Error(`${label} did not finalize with AGREE`);
  if (expectError !== /ERROR|REVERT|FAILED/.test(finalRecord.executionResultName)) throw new Error(`${label} final execution result mismatch`);
  return finalRecord;
}

async function execute(client, state, key, label, request, expectError = false) {
  const accepted = await acceptWrite(client, state, key, label, request, expectError);
  if (MODE !== "verify") return settleWrite(client, accepted);
  pendingWrites.push(accepted);
  return accepted.record;
}

async function finalizeBatch(client) {
  for (const accepted of pendingWrites) Object.assign(accepted.record, await settleWrite(client, accepted));
  pendingWrites.length = 0;
}

export async function read(client, address, functionName, args = [], finalized = MODE !== "verify") {
  return client.readContract({ address, functionName, args,
    transactionHashVariant: finalized ? "latest-final" : "latest-nonfinal" });
}

async function readUntil(client, address, functionName, args, ready, label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const value = await read(client, address, functionName, args);
    if (ready(value)) return value;
    await sleep(2000);
  }
  throw new Error(`${label} state did not become visible after accepted execution`);
}

async function findCampaign(client, verdict, title) {
  const result = await read(client, verdict, "list_campaigns", [0n, 100n]);
  return (result.campaigns ?? []).find((item) => item.title === title);
}

async function createCampaign(client, state, verdict, sponsor, fields) {
  state.campaignDeadlines ??= {};
  state.campaignDeadlines[fields.key] ??= Math.floor(Date.now() / 1000) + 7 * 86400;
  saveState(state);
  const policy = {
    schema: "VERDICTPROOF_POLICY_V1",
    submission_deadline: state.campaignDeadlines[fields.key],
    obligations: fields.obligations,
    artifact: { provider: "GITHUB", auth_mode: "GITHUB_API", owner: "tanphung", repository: "VerdictProof", path: fields.path, content_type: "text/markdown" },
    receipt: {
      source_contract: fields.escrow,
      method: "release",
      task_identifier: { selector: "args.0", value: fields.task },
      deal: { selector: "args.1", value: fields.deal },
      recipient: { selector: "args.2", value: fields.recipient },
      amount_atto: { selector: "args.3", value: fields.amount.toString() },
      kind: { selector: "args.4", value: "RELEASE" },
      released: { selector: "args.5", value: true }
    }
  };
  const record = await execute(client, state, `campaign:${fields.key}`, `Create ${fields.title}`, {
    account: sponsor, address: verdict, functionName: "create_campaign",
    args: [fields.title, APP_URL, fields.instruction, fields.proof, fields.pool, fields.reward, fields.stake, 70n, JSON.stringify(policy)], value: fields.pool
  });
  let campaign;
  for (let index = 0; index < 120 && !campaign; index += 1) { campaign = await findCampaign(client, verdict, fields.title); if (!campaign) await sleep(3000); }
  if (!campaign) throw new Error(`Campaign ${fields.title} not visible in finalized state`);
  if (Number(campaign.submission_deadline) <= Math.floor(Date.now() / 1000) && Number(campaign.submission_count) === 0 && campaign.status === "OPEN") {
    state.revisedPolicies ??= {};
    state.revisedPolicies[fields.key] ??= { ...policy, submission_deadline: Math.floor(Date.now() / 1000) + 7 * 86400 };
    saveState(state);
    await execute(client, state, `revise:${fields.key}`, `Renew unused ${fields.title}`, {
      account: sponsor, address: verdict, functionName: "revise_campaign",
      args: [BigInt(campaign.campaign_id), fields.instruction, fields.proof, JSON.stringify(state.revisedPolicies[fields.key])]
    });
    campaign = await read(client, verdict, "get_campaign", [BigInt(campaign.campaign_id)]);
  }
  return { record, campaign, policy };
}

async function releaseEvidence(client, state, escrow, tester, fields) {
  await acceptWrite(client, state, `fund:${fields.key}`, `Fund ${fields.deal}`, {
    account: tester, address: escrow, functionName: "fund_deal",
    args: [fields.task, fields.deal, fields.recipient, fields.amount], value: fields.amount
  });
  return execute(client, state, `release:${fields.key}`, `Release ${fields.deal}`, {
    account: tester, address: escrow, functionName: "release",
    args: [fields.task, fields.deal, fields.recipient, fields.amount, "RELEASE", true]
  });
}

function artifact(path) {
  const bytes = readFileSync(resolve(ROOT, path));
  if (!bytes.length || bytes.length > 4096) throw new Error(`${path} is outside the 1..4096 byte bound`);
  return { path: path.replaceAll("\\", "/"), sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length };
}

async function submit(client, state, verdict, tester, campaign, evidence, file, feedback, key, expectError = false, commit = ARTIFACT_COMMIT) {
  const campaignBefore = await read(client, verdict, "get_campaign", [BigInt(campaign.campaign_id)]);
  const before = await read(client, verdict, "get_evidence_usage", [BigInt(campaign.campaign_id), txUrl(evidence.hash), commit]);
  const record = await execute(client, state, `submit:${key}`, `Submit ${key}`, {
    account: tester, address: verdict, functionName: "submit_proof",
    args: [BigInt(campaign.campaign_id), BigInt(campaign.stake_required), txUrl(evidence.hash), commit, file.sha256, BigInt(file.byteLength), feedback],
    value: BigInt(campaign.stake_required)
  }, expectError);
  const usageArgs = [BigInt(campaign.campaign_id), txUrl(evidence.hash), commit];
  const after = expectError
    ? await read(client, verdict, "get_evidence_usage", usageArgs)
    : await readUntil(client, verdict, "get_evidence_usage", usageArgs, (value) => !value.available, key);
  if (expectError) {
    if (compact(canonical(normalized(before))) !== compact(canonical(normalized(after)))) throw new Error(`${key} expected rejection changed evidence usage`);
    const campaignAfter = await read(client, verdict, "get_campaign", [BigInt(campaign.campaign_id)]);
    if (compact(canonical(normalized(campaignBefore))) !== compact(canonical(normalized(campaignAfter)))) throw new Error(`${key} expected rejection changed campaign accounting`);
    const expectedReason = { duplicateTx: "transaction evidence has already been consumed", duplicateArtifactB: "artifact evidence has already been consumed", capacitySecond: "campaign has no unreserved reward capacity" }[key];
    if (!expectedReason) throw new Error(`Missing expected revert reason for ${key}`);
    const tx = await client.getTransaction({ hash: record.hash });
    const trace = await client.debugTraceTransaction({ hash: record.hash, round: Number(tx.lastRound?.round ?? 0) });
    const result = normalized(genlayerAbi.calldata.decode(Buffer.from(trace.return_data.slice(2), "hex")));
    if (result.kind === "Return" || typeof result.data !== "string" || !result.data.includes(`[EXPECTED] ${expectedReason}`)) throw new Error(`${key} did not revert for its expected contract guard: ${compact(result.data)}`);
    state.failedSubmissions ??= {};
    state.failedSubmissions[key] ??= normalized({ before, after, campaignBefore, campaignAfter, expectedReason, observedReason: result.data });
    saveState(state);
    return { ...state.failedSubmissions[key], record };
  }
  if (after.available) throw new Error(`${key} did not consume evidence atomically`);
  const submission = await read(client, verdict, "get_submission", [BigInt(after.transaction_submission_id)]);
  state.acceptedSubmissions ??= {};
  if (!state.acceptedSubmissions[key]) {
    if (submission.status !== "PENDING" || submission.reservation_status !== "RESERVED") throw new Error(`${key} lacks a checkpoint proving its original reservation`);
    state.acceptedSubmissions[key] = normalized(submission);
    saveState(state);
  }
  return { record, submission: state.acceptedSubmissions[key], usage: after };
}

async function review(client, state, verdict, reviewer, submission, expectedStatus, key) {
  const record = await execute(client, state, `review:${key}`, `Review ${key}`, {
    account: reviewer, address: verdict, functionName: "evaluate_submission", args: [BigInt(submission.submission_id)]
  });
  if (record.functionName !== "evaluate_submission" || record.recipient.toLowerCase() !== verdict.toLowerCase()) throw new Error(`${key} review metadata mismatch`);
  const result = await readUntil(client, verdict, "get_submission", [BigInt(submission.submission_id)],
    (value) => value.status === expectedStatus || (expectedStatus === "APPROVED" && value.status === "CLAIMED" && value.approved), key);
  const matchesStatus = result.status === expectedStatus || (expectedStatus === "APPROVED" && result.status === "CLAIMED" && result.approved);
  if (!matchesStatus || result.rubric_version !== RUBRIC) throw new Error(`${key} expected ${expectedStatus}, received ${result.status}`);
  if (result.reviewed_chunks.length !== Number(result.total_chunks) || result.obligation_assessments.length === 0) throw new Error(`${key} report does not prove complete review`);
  return { record, submission: result };
}

async function main() {
  if (!/^[0-9a-f]{40}$/.test(ARTIFACT_COMMIT)) throw new Error("Usage: npm run verify:bradbury -- <immutable-40-char-git-commit>");
  const env = envFile(resolve(ROOT, ".env"));
  const sponsor = account(env, "Sponsor", "VERDICTPROOF_SPONSOR_PRIVATE_KEY", "VERDICTPROOF_SPONSOR_ADDRESS");
  const approved = account(env, "Approved tester", "VERDICTPROOF_APPROVED_TESTER_PRIVATE_KEY", "VERDICTPROOF_APPROVED_TESTER_ADDRESS");
  const rejected = account(env, "Rejected tester", "VERDICTPROOF_REJECTED_TESTER_PRIVATE_KEY", "VERDICTPROOF_REJECTED_TESTER_ADDRESS");
  const deployments = loadJson(DEPLOYMENTS_PATH, { deployments: {} }).deployments;
  const verdictDeployment = deployments["contracts/verdict_proof.py"];
  const escrowDeployment = deployments["contracts/evidence_escrow.py"];
  if (!escrowDeployment) throw new Error("Deploy the V2.6 evidence escrow before verification");
  const escrow = escrowDeployment.contractAddress;
  const client = createClient({ chain: testnetBradbury });
  const preflight = loadJson(PREFLIGHT_STATE_PATH, { releaseId: new Date().toISOString().slice(0, 10).replaceAll("-", ""), escrow, transactions: {} });
  preflight._checkpointPath = PREFLIGHT_STATE_PATH;
  if (preflight.escrow.toLowerCase() !== escrow.toLowerCase()) throw new Error("Preflight escrow mismatch");
  const suffix = preflight.releaseId;
  const scenarios = Object.fromEntries([
    ["approved", "steward-approved.md"], ["binding", "binding-rejection.md"],
    ["semantic", "semantic-rejection.md"], ["duplicateTx", "duplicate-transaction.md"],
    ["duplicateArtifactA", "duplicate-artifact.md"], ["duplicateArtifactB", "duplicate-artifact.md"],
    ["capacity", "capacity.md"], ["expiry", "expiry.md"],
  ].map(([key, file]) => [key, { key, title: `V2.6 ${key} ${suffix}`, path: `evidence/v2.6/${file}`,
    task: `VP26-${key}-${suffix}`, deal: `DEAL-${key}-${suffix}` }]));
  if (MODE === "prepare") {
    preflight.evidence ??= {};
    const acceptedReleases = [];
    for (const scenario of [...Object.values(scenarios), {
      key: "bindingActual", task: `VP26-WRONG-${suffix}`, deal: `DEAL-WRONG-${suffix}`,
    }]) {
      await acceptWrite(client, preflight, `fund:${scenario.key}`, `Fund ${scenario.deal}`, {
        account: approved, address: escrow, functionName: "fund_deal",
        args: [scenario.task, scenario.deal, rejected.address, gen(0.001)], value: gen(0.001)
      });
      acceptedReleases.push([scenario.key, await acceptWrite(client, preflight, `release:${scenario.key}`, `Release ${scenario.deal}`, {
        account: approved, address: escrow, functionName: "release",
        args: [scenario.task, scenario.deal, rejected.address, gen(0.001), "RELEASE", true]
      })]);
    }
    for (const [key, accepted] of acceptedReleases) {
      preflight.evidence[key] = await settleWrite(client, accepted);
      saveState(preflight);
    }
    mkdirSync(resolve(ROOT, "evidence/v2.6"), { recursive: true });
    for (const scenario of Object.values(scenarios)) {
      if (scenario.key === "duplicateArtifactB") continue;
      const actual = scenario.key === "binding" ? {
        task: `VP26-WRONG-${suffix}`, deal: `DEAL-WRONG-${suffix}`,
      } : scenario;
      const receipt = preflight.evidence[scenario.key === "binding" ? "bindingActual" : scenario.key];
      let body = `# VerdictProof V2.6 ${scenario.key}\n\n` +
        `OBL-001: Finalized escrow release\nTransaction: ${txUrl(receipt.hash)}\n` +
        `Sender: ${approved.address}\nSource contract: ${escrow}\nMethod: release\n` +
        `task_identifier: ${actual.task}\ndeal_id: ${actual.deal}\nrecipient: ${rejected.address}\n` +
        `amount_atto: 1000000000000000\nkind: RELEASE\nreleased: true\n` +
        `The escrow releases this funded amount to the beneficiary. The source contract and beneficiary are different addresses.\n\n` +
        `OBL-002: Immutable artifact verification\nGitHub resolves this file at a full commit SHA. ` +
        `The contract decodes every byte, checks byte length and full SHA-256 against the declared submission, ` +
        `splits the UTF-8 text into ordered chunks of at most 1024 bytes, and records all chunk digests. ` +
        `Every validator independently retrieves and evaluates all chunks, including the final chunk; ` +
        `a matching prefix does not authenticate the rest of the document.\n\n`;
      if (["approved", "binding", "duplicateTx", "expiry"].includes(scenario.key)) {
        body += `OBL-003: Reservation and settlement rules\nAcceptance moves one reward from available to reserved. ` +
          `Approval consumes that submission's reservation even when available rewards are zero. ` +
          `The approved tester can claim exactly reward plus stake once. Rejection releases the reservation ` +
          `and slashes the stake; expiry refunds stake and releases the reservation. Closure requires no pending ` +
          `submissions and no reservations; approved claims remain payable after closure. These are contract ` +
          `rules, not a claim that this case has already been reviewed or paid.\n`;
      } else {
        body += `This negative fixture deliberately contains no explanation of reward reservation or settlement accounting.\n`;
      }
      writeFileSync(resolve(ROOT, scenario.path), body, "utf8");
    }
    console.log("Fresh finalized receipt fixtures written. Commit and push evidence/v2.6 before verify.");
    return;
  }
  if (MODE !== "inspect" && !preflight.evidence?.approved) throw new Error("Run prepare before verification");
  if (!verdictDeployment) throw new Error("Deploy VerdictProof V2.6 before full verification");
  if (MODE !== "inspect" && (!/^[0-9a-f]{40}$/.test(SECONDARY_COMMIT) || SECONDARY_COMMIT === ARTIFACT_COMMIT)) throw new Error("Set VERDICTPROOF_V26_SECONDARY_COMMIT to a second immutable commit containing the same capacity artifact");
  const verdict = verdictDeployment.contractAddress;
  const deploymentVerification = {};
  const helperDeployments = ["proof_provenance", "proof_receipt", "proof_review"].map((name) => {
    const record = deployments[`contracts/${name}.py`];
    if (!record?.contractAddress) throw new Error(`Missing ${name} deployment`);
    return record;
  });
  const components = await read(client, verdict, "get_components");
  for (const [index, key] of ["provenance", "receipt", "reviewer"].entries()) {
    if (String(components[key]).toLowerCase() !== helperDeployments[index].contractAddress.toLowerCase()) throw new Error(`Core ${key} address mismatch`);
  }
  for (const deployment of [verdictDeployment, escrowDeployment, ...helperDeployments]) {
    const local = readFileSync(resolve(ROOT, deployment.contractFile), "utf8");
    const deployed = await client.getContractCode(deployment.contractAddress);
    if (local !== deployed || createHash("sha256").update(local).digest("hex") !== deployment.sourceSha256) throw new Error(`${deployment.contractFile} deployed source mismatch`);
    const [localSchema, deployedSchema] = await Promise.all([client.getContractSchemaForCode(local), client.getContractSchema(deployment.contractAddress)]);
    if (compact(canonical(normalized(localSchema))) !== compact(canonical(normalized(deployedSchema)))) throw new Error(`${deployment.contractFile} deployed schema mismatch`);
    const deploymentTx = await client.getTransaction({ hash: deployment.deploymentTransaction });
    const consensus = snapshot(deploymentTx, deployment.deploymentTransaction);
    if (consensus.statusName !== "FINALIZED" || consensus.resultName !== "AGREE" || consensus.executionResultName !== "FINISHED_WITH_RETURN") throw new Error(`${deployment.contractFile} deployment is not finalized successfully`);
    deploymentVerification[deployment.contractFile] = { ...deployment, exactSourceMatch: true, exactSchemaMatch: true, consensus };
  }
  if (MODE === "inspect") {
    const inspection = {
      generatedAt: new Date().toISOString(), network: "testnet-bradbury",
      workflowVerified: false, deployments: deploymentVerification,
      stats: normalized(await read(client, verdict, "get_stats")),
      note: "Read-only deployment inspection. This is not submission/review/settlement verification."
    };
    const path = resolve(ROOT, "deploy", "v2.6-deployment-check.json");
    writeFileSync(path, `${JSON.stringify(inspection, null, 2)}\n`, "utf8");
    console.log(`Deployment source/schema and finality checked: ${path}`);
    return;
  }
  let state = loadJson(STATE_PATH, { artifactCommit: ARTIFACT_COMMIT, secondaryCommit: SECONDARY_COMMIT, verdict, escrow, transactions: {} });
  state._checkpointPath = STATE_PATH;
  if (state.artifactCommit !== ARTIFACT_COMMIT || state.secondaryCommit !== SECONDARY_COMMIT || state.verdict.toLowerCase() !== verdict.toLowerCase() || state.escrow.toLowerCase() !== escrow.toLowerCase()) throw new Error("V2.6 checkpoint belongs to a different immutable release");
  saveState(state);
  const amount = gen(0.001);
  const stake = gen(0.01);
  const reward = gen(0.02);
  const pool = gen(0.1);
  const baseObligations = [
    { id: "OBL-001", text: "Document exact escrow task, deal, recipient, amount, kind, and released state." },
    { id: "OBL-002", text: "Document complete immutable artifact verification and chunk coverage." },
    { id: "OBL-003", text: "Document reward reservation and settlement accounting." }
  ];
  const campaigns = {};
  for (const scenario of Object.values(scenarios)) {
    campaigns[scenario.key] = await createCampaign(client, state, verdict, sponsor, {
      ...scenario, deal: scenario.key === "binding" ? `DEAL-WRONG-${suffix}` : scenario.deal, escrow, recipient: rejected.address, amount, pool,
      reward: ["capacity", "approved"].includes(scenario.key) ? pool : reward, stake,
      obligations: baseObligations,
      instruction: "Complete the exact funded escrow release and document every accepted obligation in the immutable artifact.",
      proof: "Finalized Bradbury release receipt plus authenticated full-content GitHub artifact."
    });
  }
  const evidence = preflight.evidence;
  const bindingActual = evidence.bindingActual;
  const files = Object.fromEntries(Object.values(scenarios).map((item) => [item.key, artifact(item.path)]));
  const approvedSubmission = await submit(client, state, verdict, approved, campaigns.approved.campaign, evidence.approved, files.approved, "OBL-001 documents both the escrow destination and a different beneficiary. Label these addresses separately in an expected/actual table beside each failed gate; one generic recipient label makes a correct release look mismatched. OBL-002 describes both a full SHA-256 and ordered chunk digests. Show the full digest plus reviewed/total chunks in the report: a matching first chunk would hide a contradictory tail. OBL-003 says approval consumes a reservation independently of the available pool. Display available and reserved rewards separately and warn before signing when no slot remains. Otherwise a zero available balance misleadingly looks insolvent even when every pending reward is funded. Together these changes expose attribution, content integrity and payout capacity as three separately inspectable facts instead of one ambiguous success badge.", "approved");
  const bindingSubmission = await submit(client, state, verdict, approved, campaigns.binding.campaign, bindingActual, files.binding, "This genuine finalized release intentionally belongs to a different task. All other receipt fields match the campaign; only task binding must fail.", "binding");
  const semanticSubmission = await submit(client, state, verdict, approved, campaigns.semantic.campaign, evidence.semantic, files.semantic, "The receipt matches, but the complete artifact deliberately omits the required settlement-accounting obligation.", "semantic");
  const duplicateTx = await submit(client, state, verdict, approved, campaigns.duplicateTx.campaign, evidence.approved, files.duplicateTx, "The transaction was already consumed and this atomic submission must fail.", "duplicateTx", true);
  const duplicateFirst = await submit(client, state, verdict, approved, campaigns.duplicateArtifactA.campaign, evidence.duplicateArtifactA, files.duplicateArtifactA, "This first use consumes the immutable artifact key.", "duplicateArtifactA");
  const duplicateArtifact = await submit(client, state, verdict, approved, campaigns.duplicateArtifactB.campaign, evidence.duplicateArtifactB, files.duplicateArtifactB, "A second transaction cannot reuse the globally consumed artifact key.", "duplicateArtifactB", true);
  const capacityFirst = await submit(client, state, verdict, approved, campaigns.capacity.campaign, evidence.capacity, files.capacity, "This first submission atomically reserves the campaign's only reward slot.", "capacityFirst");
  const capacitySecond = await submit(client, state, verdict, approved, campaigns.capacity.campaign, evidence.duplicateArtifactB, files.capacity, "No capacity remains, so this must fail before evidence consumption.", "capacitySecond", true, SECONDARY_COMMIT);
  if (!capacitySecond.before.available || !capacitySecond.after.available) throw new Error("Capacity failure consumed its unique evidence references");
  const expirySubmission = await submit(client, state, verdict, approved, campaigns.expiry.campaign, evidence.expiry, files.expiry, "This pending submission demonstrates deterministic expiry and refund after the contract deadline.", "expiry");
  const approvalCapacity = state.approvalCapacity ?? await read(client, verdict, "get_campaign", [BigInt(campaigns.approved.campaign.campaign_id)]);
  if (BigInt(approvalCapacity.reward_pool) !== 0n || BigInt(approvalCapacity.reserved_reward_pool) !== pool) throw new Error("Approval regression must start with zero available pool and a fully reserved reward");
  state.approvalCapacity = normalized(approvalCapacity);
  saveState(state);
  const approvedReview = await review(client, state, verdict, sponsor, approvedSubmission.submission, "APPROVED", "approved");
  const bindingReview = await review(client, state, verdict, sponsor, bindingSubmission.submission, "REJECTED", "binding");
  const semanticReview = await review(client, state, verdict, sponsor, semanticSubmission.submission, "REJECTED", "semantic");
  if (bindingReview.submission.receipt_checks.task_identifier_match !== false ||
      Object.entries(bindingReview.submission.receipt_checks).some(([key, value]) => !["task_identifier_match", "all_match"].includes(key) && value !== true)) {
    throw new Error("Binding case must isolate exactly the task identifier mismatch");
  }
  if (!semanticReview.submission.receipt_checks.all_match ||
      semanticReview.submission.obligation_assessments.find((item) => item.obligation_id === "OBL-003")?.verdict !== "VIOLATED") {
    throw new Error("Semantic case must match every receipt gate and violate the accounting obligation");
  }
  const duplicateFirstReview = await review(client, state, verdict, sponsor, duplicateFirst.submission, "REJECTED", "duplicateArtifactA");
  const capacityReview = await review(client, state, verdict, sponsor, capacityFirst.submission, "REJECTED", "capacityFirst");
  const claim = await execute(client, state, "claim:approved", "Claim approved reward", { account: approved, address: verdict, functionName: "claim_reward", args: [BigInt(approvedSubmission.submission.submission_id)] });
  const claimed = await readUntil(client, verdict, "get_submission", [BigInt(approvedSubmission.submission.submission_id)], (value) => value.status === "CLAIMED", "Claim");
  if (claimed.status !== "CLAIMED" || claimed.reservation_status !== "CONSUMED") throw new Error("Approved payout was not consumed and claimed");
  await finalizeBatch(client);
  const finalClaimed = await read(client, verdict, "get_submission", [BigInt(approvedSubmission.submission.submission_id)], true);
  if (finalClaimed.status !== "CLAIMED") throw new Error("Claim not visible in finalized state");
  const expiryReadyAt = Number(expirySubmission.submission.review_deadline);
  if (Math.floor(Date.now() / 1000) <= expiryReadyAt) {
    writeFileSync(resolve(ROOT, "deploy", "v2.6-progress.json"), JSON.stringify({ generatedAt: new Date().toISOString(), workflowVerified: false, verdict, escrow, approvedReview, bindingReview, semanticReview, claimed, expiryReadyAt }, null, 2));
    console.log(`Expiry checkpoint is ready. Resume after ${new Date((expiryReadyAt + 1) * 1000).toISOString()}; no transaction will be duplicated.`);
    return;
  }
  const expiry = await execute(client, state, "expire:pending", "Expire pending submission", { account: rejected, address: verdict, functionName: "expire_submission", args: [BigInt(expirySubmission.submission.submission_id)] });
  const expired = await readUntil(client, verdict, "get_submission", [BigInt(expirySubmission.submission.submission_id)], (value) => value.status === "EXPIRED", "Expiry");
  if (expired.status !== "EXPIRED" || expired.reservation_status !== "RELEASED" || expired.settlement_record.kind !== "EXPIRY_REFUND") throw new Error("Expiry did not refund stake and release reservation");
  const closeRecords = {};
  for (const [key, value] of Object.entries(campaigns)) {
    const before = await read(client, verdict, "get_campaign", [BigInt(value.campaign.campaign_id)]);
    if (Number(before.submission_count) !== Number(before.approved_count) + Number(before.rejected_count) + Number(before.expired_count) || BigInt(before.reserved_reward_pool) !== 0n) throw new Error(`${key} cannot close with unresolved accounting`);
    closeRecords[key] = await execute(client, state, `close:${key}`, `Close ${key}`, { account: sponsor, address: verdict, functionName: "close_campaign", args: [BigInt(value.campaign.campaign_id)] });
  }
  await finalizeBatch(client);
  const finalCampaigns = {};
  for (const [key, value] of Object.entries(campaigns)) {
    const row = await read(client, verdict, "get_campaign", [BigInt(value.campaign.campaign_id)], true);
    if (row.status !== "CLOSED" || BigInt(row.reward_pool) !== 0n || BigInt(row.reserved_reward_pool) !== 0n) throw new Error(`${key} final close state mismatch`);
    finalCampaigns[key] = row;
  }
  const report = {
    generatedAt: new Date().toISOString(), network: "testnet-bradbury", rubricVersion: RUBRIC,
    appUrl: APP_URL, artifactCommit: ARTIFACT_COMMIT, secondaryArtifactCommit: SECONDARY_COMMIT,
    contractAddress: verdict, contractUrl: addressUrl(verdict), evidenceEscrowAddress: escrow, evidenceEscrowUrl: addressUrl(escrow),
    deployments: deploymentVerification, components: normalized(components),
    roles: { sponsor: sponsor.address, approvedTester: approved.address, rejectedTester: rejected.address },
    finalCampaigns,
    campaigns: Object.fromEntries(Object.entries(campaigns).map(([key, value]) => [key, value.campaign])),
    expectedFailures: { duplicateTransaction: duplicateTx, duplicateArtifact, capacityExhaustion: capacitySecond },
    reservationRegression: { campaignBeforeReview: normalized(approvalCapacity), approvedDespiteZeroAvailablePool: true },
    reviews: { approved: approvedReview, bindingRejected: bindingReview, semanticRejected: semanticReview, duplicateArtifactFirst: duplicateFirstReview, capacityFirst: capacityReview },
    settlements: { claim, claimed, expiry, expired, close: closeRecords },
    reviewTransactions: {
      [`${approvedSubmission.submission.campaign_id}-${approvedSubmission.submission.submission_id}`]: approvedReview.record.hash,
      [`${bindingSubmission.submission.campaign_id}-${bindingSubmission.submission.submission_id}`]: bindingReview.record.hash,
      [`${semanticSubmission.submission.campaign_id}-${semanticSubmission.submission.submission_id}`]: semanticReview.record.hash
    }
  };
  const serialized = JSON.stringify(report);
  for (const [name, raw] of Object.entries(env)) {
    if (!/private|mnemonic|password|secret/i.test(name)) continue;
    const value = String(raw).toLowerCase().replace(/^0x/, "");
    if (value.length >= 12 && serialized.toLowerCase().includes(value)) throw new Error(`Public artifact contains ${name}`);
  }
  writeFileSync(PUBLIC_ARTIFACT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`V2.6 verification complete: ${PUBLIC_ARTIFACT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(String(error?.details ?? error?.shortMessage ?? error?.message ?? error).split("\n")[0]); process.exitCode = 1; });
}
