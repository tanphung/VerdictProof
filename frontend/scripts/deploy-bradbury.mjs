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
const DEPLOYMENT_STATE = resolve(ROOT, "deploy", ".bradbury-v25-deployments.json");
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
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  const saved = existsSync(DEPLOYMENT_STATE)
    ? JSON.parse(readFileSync(DEPLOYMENT_STATE, "utf8"))
    : { deployments: {} };
  const prior = saved.deployments?.[CONTRACT_FILE];
  if (prior?.sourceSha256 === sourceSha256 && /^0x[a-fA-F0-9]{40}$/.test(prior.contractAddress ?? "")) {
    const deployed = await createClient({ chain: testnetBradbury }).getContractCode(prior.contractAddress);
    if (deployed === source) {
      console.log(`Resuming verified deployment for ${CONTRACT_FILE}.`);
      console.log(JSON.stringify(prior));
      return;
    }
    throw new Error(`Saved ${CONTRACT_FILE} deployment does not match local source`);
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
    genlayerAbi.calldata.makeCalldataObject(undefined, [], undefined)
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
      gas = (estimated * 6n) / 5n + 250_000n;
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
  const evmReceipt = await publicClient.waitForTransactionReceipt({ hash: evmHash });
  if (evmReceipt.status !== "success") throw new Error(`Deployment EVM transaction reverted: ${evmHash}`);
  const genlayerHash = extractGenlayerTxId(evmReceipt.logs, consensusAddress);
  if (!genlayerHash) throw new Error("No GenLayer deployment transaction id was emitted");
  console.log(`Deployment GenLayer transaction: ${genlayerHash}`);

  const client = createClient({ chain: testnetBradbury });
  const contractAddress = await waitForExecution(client, genlayerHash);
  saved.deployments ??= {};
  saved.deployments[CONTRACT_FILE] = {
    contractFile: CONTRACT_FILE,
    sourceSha256,
    contractAddress,
    deploymentTransaction: genlayerHash,
    evmTransaction: evmHash
  };
  writeFileSync(DEPLOYMENT_STATE, `${JSON.stringify(saved, null, 2)}\n`, "utf8");
  console.log(`Contract address: ${contractAddress}`);
  console.log(JSON.stringify(saved.deployments[CONTRACT_FILE]));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
