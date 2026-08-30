import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const RUBRIC = "VERDICTPROOF_V2_5_FULL_ASSURANCE";
const STATE_PATH = resolve(ROOT, "deploy", ".bradbury-v25-verification-state.json");
const PREFLIGHT_STATE_PATH = resolve(ROOT, "deploy", ".bradbury-v25-preflight-state.json");
const DEPLOYMENTS_PATH = resolve(ROOT, "deploy", ".bradbury-v25-deployments.json");
const PUBLIC_ARTIFACT = resolve(ROOT, "deploy", "latest-bradbury-verification.json");
const ARTIFACT_COMMIT = String(process.argv[2] ?? "").toLowerCase();
const MODE = String(process.argv[3] ?? "verify");
const SECONDARY_COMMIT = String(process.env.VERDICTPROOF_V25_SECONDARY_COMMIT ?? "").toLowerCase();
if (!/^[0-9a-f]{40}$/.test(ARTIFACT_COMMIT)) {
  throw new Error("Usage: npm run verify:bradbury -- <immutable-40-char-git-commit>");
}

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

async function sendWrite(request) {
  const consensusAddress = testnetBradbury.consensusMainContract?.address;
  const consensusAbi = testnetBradbury.consensusMainContract?.abi ?? [];
  const add = consensusAbi.find((entry) => entry.type === "function" && entry.name === "addTransaction");
  if (!consensusAddress || !add?.inputs) throw new Error("Bradbury addTransaction ABI is unavailable");
  const calldata = genlayerAbi.calldata.encode(genlayerAbi.calldata.makeCalldataObject(request.functionName, request.args ?? [], undefined));
  const transactionData = genlayerAbi.transactions.serialize([calldata, false]);
  const base = [request.account.address, request.address, INITIAL_VALIDATORS, BigInt(testnetBradbury.defaultConsensusMaxRotations ?? 3), transactionData];
  const args = add.inputs.length >= 6 ? [...base, BigInt(Math.floor(Date.now() / 1000) + 3600)] : base;
  const data = encodeFunctionData({ abi: [{ ...add, inputs: add.inputs.slice(0, args.length) }], functionName: "addTransaction", args });
  const gas = await publicClient.estimateGas({ account: request.account, to: consensusAddress, data, value: request.value ?? 0n });
  const wallet = createWalletClient({ account: request.account, chain: testnetBradbury, transport: http(testnetBradbury.rpcUrls.default.http[0]) });
  const evmHash = await wallet.sendTransaction({ account: request.account, chain: testnetBradbury, to: consensusAddress, data, value: request.value ?? 0n, gas: gas * 2n + 100_000n, gasPrice: await publicClient.getGasPrice(), type: "legacy" });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: evmHash });
  if (receipt.status !== "success") throw new Error(`Bradbury EVM write reverted: ${evmHash}`);
  return extractGenlayerTxId(receipt.logs, consensusAddress);
}

async function checkpointWrite(client, state, key, label, request) {
  const existing = state.transactions[key];
  if (existing) {
    const tx = await client.getTransaction({ hash: existing });
    const call = callDetails(tx);
    if (String(tx.recipient).toLowerCase() !== request.address.toLowerCase() || call.method !== request.functionName || compact(call.args) !== compact(normalized(request.args ?? []))) {
      throw new Error(`${label} checkpoint does not match exact recipient, method, and calldata`);
    }
    console.log(`${label}: resuming ${existing}`);
    return existing;
  }
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const hash = await sendWrite(request);
      state.transactions[key] = hash;
      saveState(state);
      return hash;
    } catch (error) {
      lastError = error;
      const message = String(error?.message ?? error);
      if (!/timeout|429|rate limit|capacity|backpressure|pending|-32005|-32429/i.test(message) || attempt === 5) break;
      await sleep(15_000 * attempt);
    }
  }
  throw lastError;
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
      const terminal = ["ACCEPTED", "READY_TO_FINALIZE", "FINALIZED"].includes(record.statusName);
      if (terminal && record.resultName === "AGREE") {
        if (expectError && /ERROR|REVERT|FAILED/.test(record.executionResultName)) return record;
        if (!expectError && record.executionResultName === "FINISHED_WITH_RETURN") return record;
        if (expectError && record.executionResultName === "FINISHED_WITH_RETURN") throw new Error(`${label} unexpectedly succeeded`);
      }
      if (/DISAGREE|UNDETERMINED|CANCELED/.test(`${record.resultName}/${record.statusName}`)) throw new Error(`${label} failed consensus: ${stage}`);
    } catch (error) {
      if (/unexpectedly succeeded|failed consensus/.test(String(error?.message ?? error))) throw error;
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
    const tx = await client.getTransaction({ hash });
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
  return settleWrite(client, await acceptWrite(client, state, key, label, request, expectError));
}

async function read(client, address, functionName, args = []) {
  return client.readContract({ address, functionName, args, stateStatus: "finalized" });
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
  const before = await read(client, verdict, "get_evidence_usage", [BigInt(campaign.campaign_id), txUrl(evidence.hash), commit]);
  const record = await execute(client, state, `submit:${key}`, `Submit ${key}`, {
    account: tester, address: verdict, functionName: "submit_proof",
    args: [BigInt(campaign.campaign_id), BigInt(campaign.stake_required), txUrl(evidence.hash), commit, file.sha256, BigInt(file.byteLength), feedback],
    value: BigInt(campaign.stake_required)
  }, expectError);
  const after = await read(client, verdict, "get_evidence_usage", [BigInt(campaign.campaign_id), txUrl(evidence.hash), commit]);
  if (expectError) {
    if (compact(canonical(normalized(before))) !== compact(canonical(normalized(after)))) throw new Error(`${key} expected rejection changed evidence usage`);
    return { record, before, after };
  }
  if (after.available) throw new Error(`${key} did not consume evidence atomically`);
  const submission = await read(client, verdict, "get_submission", [BigInt(after.transaction_submission_id)]);
  if (submission.status !== "PENDING" || submission.reservation_status !== "RESERVED") throw new Error(`${key} did not reserve reward capacity`);
  return { record, submission, usage: after };
}

async function review(client, state, verdict, reviewer, submission, expectedStatus, key) {
  const record = await execute(client, state, `review:${key}`, `Review ${key}`, {
    account: reviewer, address: verdict, functionName: "evaluate_submission", args: [BigInt(submission.submission_id)]
  });
  if (record.functionName !== "evaluate_submission" || record.recipient.toLowerCase() !== verdict.toLowerCase()) throw new Error(`${key} review metadata mismatch`);
  const result = await read(client, verdict, "get_submission", [BigInt(submission.submission_id)]);
  if (result.status !== expectedStatus || result.rubric_version !== RUBRIC) throw new Error(`${key} expected ${expectedStatus}, received ${result.status}`);
  if (result.reviewed_chunks.length !== Number(result.total_chunks) || result.obligation_assessments.length === 0) throw new Error(`${key} report does not prove complete review`);
  return { record, submission: result };
}

async function main() {
  const env = envFile(resolve(ROOT, ".env"));
  const sponsor = account(env, "Sponsor", "VERDICTPROOF_SPONSOR_PRIVATE_KEY", "VERDICTPROOF_SPONSOR_ADDRESS");
  const approved = account(env, "Approved tester", "VERDICTPROOF_APPROVED_TESTER_PRIVATE_KEY", "VERDICTPROOF_APPROVED_TESTER_ADDRESS");
  const rejected = account(env, "Rejected tester", "VERDICTPROOF_REJECTED_TESTER_PRIVATE_KEY", "VERDICTPROOF_REJECTED_TESTER_ADDRESS");
  const deployments = loadJson(DEPLOYMENTS_PATH, { deployments: {} }).deployments;
  const verdictDeployment = deployments["contracts/verdict_proof.py"];
  const escrowDeployment = deployments["contracts/evidence_escrow.py"];
  if (!escrowDeployment) throw new Error("Deploy the V2.5 evidence escrow before verification");
  const escrow = escrowDeployment.contractAddress;
  const client = createClient({ chain: testnetBradbury });
  if (MODE === "prepare") {
    let preflight = loadJson(PREFLIGHT_STATE_PATH, { artifactCommit: ARTIFACT_COMMIT, escrow, transactions: {} });
    preflight._checkpointPath = PREFLIGHT_STATE_PATH;
    if (preflight.artifactCommit !== ARTIFACT_COMMIT || preflight.escrow.toLowerCase() !== escrow.toLowerCase()) throw new Error("Preflight checkpoint belongs to another release");
    const release = await releaseEvidence(client, preflight, escrow, approved, {
      key: "studionetPreflight", task: `VP25-STUDIONET-${ARTIFACT_COMMIT.slice(0, 8)}`,
      deal: `DEAL-STUDIONET-${ARTIFACT_COMMIT.slice(0, 8)}`, recipient: rejected.address, amount: gen(0.001)
    });
    console.log(JSON.stringify({ escrow, releaseTransaction: release.hash, transactionUrl: txUrl(release.hash) }));
    return;
  }
  if (!verdictDeployment) throw new Error("Deploy VerdictProof V2.5 before full verification");
  if (!/^[0-9a-f]{40}$/.test(SECONDARY_COMMIT) || SECONDARY_COMMIT === ARTIFACT_COMMIT) throw new Error("Set VERDICTPROOF_V25_SECONDARY_COMMIT to a second immutable commit containing the same capacity artifact");
  const verdict = verdictDeployment.contractAddress;
  const deploymentVerification = {};
  for (const deployment of [verdictDeployment, escrowDeployment]) {
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
  let state = loadJson(STATE_PATH, { artifactCommit: ARTIFACT_COMMIT, secondaryCommit: SECONDARY_COMMIT, verdict, escrow, transactions: {} });
  state._checkpointPath = STATE_PATH;
  if (state.artifactCommit !== ARTIFACT_COMMIT || state.secondaryCommit !== SECONDARY_COMMIT || state.verdict.toLowerCase() !== verdict.toLowerCase() || state.escrow.toLowerCase() !== escrow.toLowerCase()) throw new Error("V2.5 checkpoint belongs to a different immutable release");
  saveState(state);
  const suffix = ARTIFACT_COMMIT.slice(0, 8);
  const amount = gen(0.001);
  const stake = gen(0.01);
  const reward = gen(0.02);
  const pool = gen(0.1);
  const baseObligations = [
    { id: "OBL-001", text: "Document exact escrow task, deal, recipient, amount, kind, and released state." },
    { id: "OBL-002", text: "Document complete immutable artifact verification and chunk coverage." },
    { id: "OBL-003", text: "Document reward reservation and settlement accounting." }
  ];
  const scenarios = {
    approved: { key: "approved", title: `V2.5 Full Assurance Approval ${suffix}`, path: "evidence/v2.5/approved.md", task: `VP25-APPROVED-${suffix}`, deal: `DEAL-APPROVED-${suffix}` },
    binding: { key: "binding", title: `V2.5 Exact Binding Rejection ${suffix}`, path: "evidence/v2.5/binding-rejection.md", task: `VP25-BIND-${suffix}`, deal: `DEAL-BIND-${suffix}` },
    semantic: { key: "semantic", title: `V2.5 Obligation Rejection ${suffix}`, path: "evidence/v2.5/semantic-rejection.md", task: `VP25-SEMANTIC-${suffix}`, deal: `DEAL-SEMANTIC-${suffix}` },
    duplicateTx: { key: "duplicateTx", title: `V2.5 Duplicate Transaction ${suffix}`, path: "evidence/v2.5/duplicate-transaction.md", task: `VP25-DUP-TX-${suffix}`, deal: `DEAL-DUP-TX-${suffix}` },
    duplicateArtifactA: { key: "duplicateArtifactA", title: `V2.5 Artifact Consumption A ${suffix}`, path: "evidence/v2.5/duplicate-artifact.md", task: `VP25-DUP-ART-A-${suffix}`, deal: `DEAL-DUP-ART-A-${suffix}` },
    duplicateArtifactB: { key: "duplicateArtifactB", title: `V2.5 Artifact Consumption B ${suffix}`, path: "evidence/v2.5/duplicate-artifact.md", task: `VP25-DUP-ART-B-${suffix}`, deal: `DEAL-DUP-ART-B-${suffix}` },
    capacity: { key: "capacity", title: `V2.5 Atomic Capacity ${suffix}`, path: "evidence/v2.5/capacity.md", task: `VP25-CAPACITY-${suffix}`, deal: `DEAL-CAPACITY-${suffix}` },
    expiry: { key: "expiry", title: `V2.5 Deterministic Expiry ${suffix}`, path: "evidence/v2.5/expiry.md", task: `VP25-EXPIRY-${suffix}`, deal: `DEAL-EXPIRY-${suffix}` }
  };
  const campaigns = {};
  for (const scenario of Object.values(scenarios)) {
    campaigns[scenario.key] = await createCampaign(client, state, verdict, sponsor, {
      ...scenario, escrow, recipient: rejected.address, amount, pool,
      reward: scenario.key === "capacity" ? pool : reward, stake,
      obligations: baseObligations,
      instruction: "Complete the exact funded escrow release and document every accepted obligation in the immutable artifact.",
      proof: "Finalized Bradbury release receipt plus authenticated full-content GitHub artifact."
    });
  }
  const evidence = {};
  for (const scenario of Object.values(scenarios)) {
    evidence[scenario.key] = await releaseEvidence(client, state, escrow, approved, { ...scenario, recipient: rejected.address, amount });
  }
  const bindingActual = await releaseEvidence(client, state, escrow, approved, {
    key: "bindingActual", task: `VP25-BIND-WRONG-${suffix}`, deal: `DEAL-BIND-WRONG-${suffix}`,
    recipient: rejected.address, amount
  });
  const files = Object.fromEntries(Object.values(scenarios).map((item) => [item.key, artifact(item.path)]));
  const approvedSubmission = await submit(client, state, verdict, approved, campaigns.approved.campaign, evidence.approved, files.approved, "I verified three linked controls: the finalized release calldata contains the exact task, deal, recipient, amount, kind and released state; the GitHub manifest covers every byte with ordered chunk digests; and reward capacity is reserved before review. The report should keep the exact mismatched field beside each gate and warn about consumed evidence before wallet signing. Those changes would shorten receipt debugging without weakening contract enforcement.", "approved");
  const bindingSubmission = await submit(client, state, verdict, approved, campaigns.binding.campaign, bindingActual, files.binding, "This genuine finalized release intentionally belongs to a different task and deal and must fail exact binding.", "binding");
  const semanticSubmission = await submit(client, state, verdict, approved, campaigns.semantic.campaign, evidence.semantic, files.semantic, "The receipt matches, but the complete artifact deliberately omits the required settlement-accounting obligation.", "semantic");
  const duplicateTx = await submit(client, state, verdict, approved, campaigns.duplicateTx.campaign, evidence.approved, files.duplicateTx, "The transaction was already consumed and this atomic submission must fail.", "duplicateTx", true);
  const duplicateFirst = await submit(client, state, verdict, approved, campaigns.duplicateArtifactA.campaign, evidence.duplicateArtifactA, files.duplicateArtifactA, "This first use consumes the immutable artifact key.", "duplicateArtifactA");
  const duplicateArtifact = await submit(client, state, verdict, approved, campaigns.duplicateArtifactB.campaign, evidence.duplicateArtifactB, files.duplicateArtifactB, "A second transaction cannot reuse the globally consumed artifact key.", "duplicateArtifactB", true);
  const capacityFirst = await submit(client, state, verdict, approved, campaigns.capacity.campaign, evidence.capacity, files.capacity, "This first submission atomically reserves the campaign's only reward slot.", "capacityFirst");
  const capacitySecond = await submit(client, state, verdict, approved, campaigns.capacity.campaign, evidence.duplicateArtifactB, files.capacity, "No capacity remains, so this must fail before evidence consumption.", "capacitySecond", true, SECONDARY_COMMIT);
  if (!capacitySecond.before.available || !capacitySecond.after.available) throw new Error("Capacity failure consumed its unique evidence references");
  const expirySubmission = await submit(client, state, verdict, approved, campaigns.expiry.campaign, evidence.expiry, files.expiry, "This pending submission demonstrates deterministic expiry and refund after the contract deadline.", "expiry");
  const approvedReview = await review(client, state, verdict, sponsor, approvedSubmission.submission, "APPROVED", "approved");
  const bindingReview = await review(client, state, verdict, sponsor, bindingSubmission.submission, "REJECTED", "binding");
  const semanticReview = await review(client, state, verdict, sponsor, semanticSubmission.submission, "REJECTED", "semantic");
  const duplicateFirstReview = await review(client, state, verdict, sponsor, duplicateFirst.submission, "REJECTED", "duplicateArtifactA");
  const capacityReview = await review(client, state, verdict, sponsor, capacityFirst.submission, "REJECTED", "capacityFirst");
  const claim = await execute(client, state, "claim:approved", "Claim approved reward", { account: approved, address: verdict, functionName: "claim_reward", args: [BigInt(approvedSubmission.submission.submission_id)] });
  const claimed = await read(client, verdict, "get_submission", [BigInt(approvedSubmission.submission.submission_id)]);
  if (claimed.status !== "CLAIMED" || claimed.reservation_status !== "CONSUMED") throw new Error("Approved payout was not consumed and claimed");
  const expiryReadyAt = Number(expirySubmission.submission.review_deadline);
  if (Math.floor(Date.now() / 1000) <= expiryReadyAt) {
    console.log(`Expiry checkpoint is ready. Resume after ${new Date((expiryReadyAt + 1) * 1000).toISOString()}; no transaction will be duplicated.`);
    return;
  }
  const expiry = await execute(client, state, "expire:pending", "Expire pending submission", { account: rejected, address: verdict, functionName: "expire_submission", args: [BigInt(expirySubmission.submission.submission_id)] });
  const expired = await read(client, verdict, "get_submission", [BigInt(expirySubmission.submission.submission_id)]);
  if (expired.status !== "EXPIRED" || expired.reservation_status !== "RELEASED" || expired.settlement_record.kind !== "EXPIRY_REFUND") throw new Error("Expiry did not refund stake and release reservation");
  const closeRecords = {};
  for (const [key, value] of Object.entries(campaigns)) {
    const before = await read(client, verdict, "get_campaign", [BigInt(value.campaign.campaign_id)]);
    if (Number(before.submission_count) !== Number(before.approved_count) + Number(before.rejected_count) + Number(before.expired_count) || BigInt(before.reserved_reward_pool) !== 0n) throw new Error(`${key} cannot close with unresolved accounting`);
    closeRecords[key] = await execute(client, state, `close:${key}`, `Close ${key}`, { account: sponsor, address: verdict, functionName: "close_campaign", args: [BigInt(value.campaign.campaign_id)] });
  }
  const report = {
    generatedAt: new Date().toISOString(), network: "testnet-bradbury", rubricVersion: RUBRIC,
    appUrl: APP_URL, artifactCommit: ARTIFACT_COMMIT, secondaryArtifactCommit: SECONDARY_COMMIT,
    contractAddress: verdict, contractUrl: addressUrl(verdict), evidenceEscrowAddress: escrow, evidenceEscrowUrl: addressUrl(escrow),
    deployments: { verdictProof: deploymentVerification["contracts/verdict_proof.py"], evidenceEscrow: deploymentVerification["contracts/evidence_escrow.py"] },
    roles: { sponsor: sponsor.address, approvedTester: approved.address, rejectedTester: rejected.address },
    campaigns: Object.fromEntries(Object.entries(campaigns).map(([key, value]) => [key, value.campaign])),
    expectedFailures: { duplicateTransaction: duplicateTx, duplicateArtifact, capacityExhaustion: capacitySecond },
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
  console.log(`V2.5 verification complete: ${PUBLIC_ARTIFACT}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
