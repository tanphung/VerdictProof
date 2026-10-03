import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseEventLogs,
  zeroAddress
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { abi as genlayerAbi, createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RPC_URL = testnetBradbury.rpcUrls.default.http[0];
const INITIAL_VALIDATORS = 5n;
const CONTRACT_FILE = String(process.env.VERDICTPROOF_DEPLOY_CONTRACT ?? "contracts/verdict_proof.py").replaceAll("\\", "/");
const REVISION = String(process.env.VERDICTPROOF_RELEASE_REVISION ?? "");
if (REVISION && !/^r[1-9][0-9]*$/.test(REVISION)) throw new Error("Invalid release revision");
const DEPLOYMENT_STATE = resolve(ROOT, "deploy", `.bradbury-v26${REVISION ? `-${REVISION}` : ""}-deployments.json`);
const rpcTransport = () => http(RPC_URL, { retryCount: 0, timeout: 120_000 });

function readEnv(path) {
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return values;
}

function extractGenlayerTxId(logs, consensusAddress) {
  const createdTransactionAbi = [{
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "bytes32", name: "txId", type: "bytes32" },
      { indexed: false, internalType: "uint256", name: "txSlot", type: "uint256" }
    ],
    name: "CreatedTransaction",
    type: "event"
  }];
  try {
    const events = parseEventLogs({ abi: createdTransactionAbi, eventName: "CreatedTransaction", logs });
    if (typeof events[0]?.args?.txId === "string") return events[0].args.txId;
  } catch {
    // Topic scanning supports consensus ABI/event variations.
  }
  const normalizedConsensus = consensusAddress.toLowerCase();
  for (const log of logs) {
    if (String(log.address ?? "").toLowerCase() !== normalizedConsensus) continue;
    const candidate = log.topics?.[1];
    if (candidate && /^0x[0-9a-fA-F]{64}$/.test(candidate) && !/^0x0{64}$/i.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function waitForExecution(client, hash) {
  let previous = "";
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const tx = await client.getTransaction({ hash });
    const status = String(tx.statusName ?? tx.status_name ?? tx.status ?? "").toUpperCase();
    const consensus = String(tx.resultName ?? tx.result_name ?? "").toUpperCase();
    const execution = String(tx.txExecutionResultName ?? "").toUpperCase();
    const state = `${status || "UNKNOWN"} / ${execution || consensus || "UNKNOWN"}`;
    if (state !== previous) {
      console.log(`Deployment lifecycle: ${state}`);
      previous = state;
    }
    if (/ERROR|REVERT|FAILED/.test(execution) || (/ACCEPTED|FINALIZED/.test(status) && consensus !== "AGREE")) {
      throw new Error(`Deployment failed: ${state}`);
    }
    if (/ACCEPTED|READY_TO_FINALIZE|FINALIZED/.test(status) && consensus === "AGREE" && execution === "FINISHED_WITH_RETURN") {
      const address = String(tx.recipient ?? "");
      if (!/^0x[a-fA-F0-9]{40}$/.test(address) || address.toLowerCase() === zeroAddress) {
        throw new Error("Deployment executed but did not expose a valid contract address");
      }
      return address;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 5000));
  }
  throw new Error("Deployment did not execute within 30 minutes");
}

async function waitForFinalized(client, account, hash) {
  const evmClient = createPublicClient({ chain: testnetBradbury, transport: rpcTransport() });
  const consensusAddress = testnetBradbury.consensusMainContract?.address;
  const finalizeAbi = (testnetBradbury.consensusMainContract?.abi ?? []).find(
    (entry) => entry.type === "function" && entry.name === "finalizeTransaction"
  );
  if (!consensusAddress || !finalizeAbi) throw new Error("Bradbury finalizeTransaction ABI is unavailable");
  let attempted = false;
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const tx = await client.getTransaction({ hash });
    const status = String(tx.statusName ?? tx.status_name ?? tx.status ?? "").toUpperCase();
    if (status === "FINALIZED") return;
    if (status === "READY_TO_FINALIZE" && !attempted) {
      attempted = true;
      const data = encodeFunctionData({ abi: [finalizeAbi], functionName: "finalizeTransaction", args: [hash] });
      try {
        const wallet = createWalletClient({ account, chain: testnetBradbury, transport: rpcTransport() });
        const evmHash = await wallet.sendTransaction({
          account, chain: testnetBradbury, to: consensusAddress, data,
          gas: 300_000n, gasPrice: await evmClient.getGasPrice(), type: "legacy"
        });
        await evmClient.waitForTransactionReceipt({ hash: evmHash });
        console.log(`Finalization EVM transaction: ${evmHash}`);
      } catch (error) {
        const message = String(error?.message ?? error);
        if (!/already|finaliz|capacity|backpressure|rate/i.test(message)) throw error;
        attempted = false;
      }
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 5000));
  }
  throw new Error("Deployment did not reach FINALIZED within the verification window");
}

async function main() {
  const env = readEnv(resolve(ROOT, ".env"));
  const rawKey = String(env.ACCOUNT_PRIVATE_KEY ?? "");
  const key = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("ACCOUNT_PRIVATE_KEY is missing or invalid");
  const account = privateKeyToAccount(key);
  const expectedAddress = String(env.EXPECTED_WALLET_ADDRESS ?? "").toLowerCase();
  if (expectedAddress && account.address.toLowerCase() !== expectedAddress) {
    throw new Error("Deployment key does not match EXPECTED_WALLET_ADDRESS");
  }

  const consensusAddress = testnetBradbury.consensusMainContract?.address;
  const consensusAbi = testnetBradbury.consensusMainContract?.abi ?? [];
  const addTransaction = consensusAbi.find((entry) => entry.type === "function" && entry.name === "addTransaction");
  if (!consensusAddress || !addTransaction?.inputs) {
    throw new Error("Bradbury addTransaction ABI is unavailable");
  }

  const sourcePath = resolve(ROOT, CONTRACT_FILE);
  let source = readFileSync(sourcePath, "utf8");
  if (!/^# v0\.1\.0\r?\n# \{ "Depends": "py-genlayer:[a-z0-9]+" \}/.test(source)) {
    throw new Error("Contract must declare its runner version before a concrete dependency pin");
  }
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  const saved = existsSync(DEPLOYMENT_STATE)
    ? JSON.parse(readFileSync(DEPLOYMENT_STATE, "utf8"))
    : { deployments: {} };
  const helperFiles = ["proof_provenance", "proof_receipt", "proof_review"];
  const constructorArgs = CONTRACT_FILE === "contracts/verdict_proof.py" ? helperFiles.map((name) => {
    const helper = saved.deployments?.[`contracts/${name}.py`];
    if (!helper?.contractAddress || helper.status !== "FINALIZED") throw new Error(`Finalize ${name} before deploying the core`);
    const localHash = createHash("sha256").update(readFileSync(resolve(ROOT, helper.contractFile))).digest("hex");
    if (localHash !== helper.sourceSha256) throw new Error(`${name} source changed since deployment`);
    return helper.contractAddress;
  }) : [];
  const prior = saved.deployments?.[CONTRACT_FILE];
  const persist = (record) => {
    const latest = existsSync(DEPLOYMENT_STATE) ? JSON.parse(readFileSync(DEPLOYMENT_STATE, "utf8")) : { deployments: {} };
    latest.deployments[CONTRACT_FILE] = record;
    writeFileSync(DEPLOYMENT_STATE, `${JSON.stringify(latest, null, 2)}\n`, "utf8");
  };
  const complete = async (record) => {
    const publicClient = createPublicClient({ chain: testnetBradbury, transport: rpcTransport() });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: record.evmTransaction });
    if (receipt.status !== "success") throw new Error("Deployment EVM transaction reverted; checkpoint retained");
    record.deploymentTransaction ??= extractGenlayerTxId(receipt.logs, consensusAddress);
    if (!record.deploymentTransaction) throw new Error("Deployment transaction id missing; checkpoint retained");
    persist(record);
    console.log(`Deployment GenLayer transaction: ${record.deploymentTransaction}`);
    const client = createClient({ chain: testnetBradbury });
    record.contractAddress = await waitForExecution(client, record.deploymentTransaction);
    persist(record);
    console.log(`Contract address (awaiting finality): ${record.contractAddress}`);
    if (process.env.VERDICTPROOF_DEPLOY_ACCEPT_ONLY === "1" && record.status !== "FINALIZED") {
      record.status = "ACCEPTED"; persist(record); return;
    }
    await waitForFinalized(client, account, record.deploymentTransaction);
    const deployed = await client.getContractCode(record.contractAddress);
    if (deployed !== source) throw new Error("Deployed source differs from local source");
    record.status = "FINALIZED";
    persist(record);
    console.log(JSON.stringify(record));
  };
  if (prior) {
    if (prior.sourceSha256 !== sourceSha256 || prior.sender !== account.address || JSON.stringify(prior.constructorArgs ?? []) !== JSON.stringify(constructorArgs)) {
      throw new Error("Release checkpoint source or sender mismatch; refusing to overwrite deployment");
    }
    if (!prior.evmTransaction) throw new Error("Incomplete deployment checkpoint requires inspection");
    await complete(prior);
    return;
  }
  const controlContract = String(process.env.VERDICTPROOF_DEPLOY_CONTROL_CONTRACT ?? "");
  if (controlContract) {
    if (process.env.VERDICTPROOF_DEPLOY_DRY_RUN !== "1" || !/^0x[a-fA-F0-9]{40}$/.test(controlContract)) {
      throw new Error("VERDICTPROOF_DEPLOY_CONTROL_CONTRACT is only allowed for a valid dry-run control");
    }
    source = await createClient({ chain: testnetBradbury }).getContractCode(controlContract);
    console.log(`Dry-run control uses deployed source from ${controlContract}.`);
  }
  const constructorCalldata = genlayerAbi.calldata.encode(
    genlayerAbi.calldata.makeCalldataObject(undefined, constructorArgs, undefined)
  );
  const transactionData = genlayerAbi.transactions.serialize([source, constructorCalldata, false]);
  const baseArgs = [
    account.address,
    zeroAddress,
    INITIAL_VALIDATORS,
    BigInt(testnetBradbury.defaultConsensusMaxRotations ?? 3),
    transactionData
  ];
  const args = addTransaction.inputs.length >= 6
    ? [...baseArgs, BigInt(Math.floor(Date.now() / 1000) + 3600)]
    : baseArgs;
  const data = encodeFunctionData({
    abi: [{ ...addTransaction, inputs: addTransaction.inputs.slice(0, args.length) }],
    functionName: "addTransaction",
    args
  });

  const publicClient = createPublicClient({ chain: testnetBradbury, transport: rpcTransport() });
  let gas = 0n;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const estimated = await publicClient.estimateGas({ account, to: consensusAddress, data });
      const cap = 16_777_216n;
      if (estimated >= cap) throw new Error(`Estimated gas ${estimated} exceeds Bradbury transaction cap ${cap}`);
      const padded = (estimated * 6n) / 5n + 250_000n;
      gas = padded < cap ? padded : cap;
      console.log(`Bradbury gas estimate accepted: ${estimated}`);
      break;
    } catch (error) {
      const detail = String(error?.details ?? error?.cause?.message ?? "").split("\n")[0];
      const message = detail || (error instanceof Error ? error.message.split("\n")[0] : String(error));
      const capacityLimited = /BlockPubdataLimitReached|-32005|gas rate limit exceeded|node is at capacity/i.test(message);
      if (!capacityLimited || attempt === 5) {
        throw new Error(`Bradbury gas estimate unavailable; deployment was not sent: ${message}`);
      }
      const waitMs = 15_000 * attempt;
      console.log(`Bradbury estimate capacity-limited; retrying in ${waitMs}ms (${attempt}/5).`);
      await new Promise((resolveSleep) => setTimeout(resolveSleep, waitMs));
    }
  }
  if (gas === 0n) throw new Error("Bradbury gas estimate did not produce a usable gas limit");
  if (process.env.VERDICTPROOF_DEPLOY_DRY_RUN === "1") {
    console.log(`Dry run complete; no transaction was signed or sent. Selected gas: ${gas}.`);
    return;
  }
  const gasPrice = await publicClient.getGasPrice();
  const walletClient = createWalletClient({ account, chain: testnetBradbury, transport: rpcTransport() });
  let evmHash;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      evmHash = await walletClient.sendTransaction({
        account,
        chain: testnetBradbury,
        to: consensusAddress,
        data,
        gas,
        gasPrice,
        type: "legacy"
      });
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const capacityLimited = /-32005|gas rate limit exceeded|node is at capacity/i.test(message);
      if (!capacityLimited || attempt === 5) throw error;
      const retryMatch = message.match(/retryAfterMs["':\s]*(\d+)/i);
      const waitMs = Math.max(2000, Number(retryMatch?.[1] ?? 0) + 1000);
      console.log(`Bradbury sender capacity-limited; retrying in ${waitMs}ms (${attempt}/5).`);
      await new Promise((resolveSleep) => setTimeout(resolveSleep, waitMs));
    }
  }
  if (!evmHash) throw new Error("Bradbury did not accept the deployment transaction");
  console.log(`Deployment EVM transaction: ${evmHash}`);
  const record = { contractFile: CONTRACT_FILE, sourceSha256, constructorArgs, sender: account.address, evmTransaction: evmHash };
  persist(record);
  await complete(record);
}

main().catch((error) => {
  console.error(String(error?.details ?? error?.shortMessage ?? error?.message ?? error).split("\n")[0]);
  process.exitCode = 1;
});
