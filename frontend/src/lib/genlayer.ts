import { abi as genlayerAbi, createAccount, createClient, generatePrivateKey } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { createPublicClient, encodeFunctionData, http, parseEventLogs } from "viem";

declare global {
  interface Window {
    __VERDICTPROOF_CONFIG__?: {
      contractAddress?: string;
      chain?: string;
      explorer?: string;
    };
  }
}

const runtimeConfig = typeof window === "undefined" ? undefined : window.__VERDICTPROOF_CONFIG__;

export const CONTRACT_ADDRESS = runtimeConfig?.contractAddress || import.meta.env.VITE_SIGNALSTAKE_CONTRACT_ADDRESS || "";
export const EXPLORER =
  runtimeConfig?.explorer || import.meta.env.VITE_GENLAYER_EXPLORER || "https://explorer-bradbury.genlayer.com";
export const CHAIN = testnetBradbury;

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

let readClientCache: ReturnType<typeof createClient> | null = null;
let readQueue = Promise.resolve();
let bradburyNetworkSynced = false;

type ContractAbiEntry = {
  type?: string;
  name?: string;
  inputs?: readonly unknown[];
};

export type TxStage = "pending" | "accepted" | "finalized" | "failed";

export type TxStatus = {
  stage: TxStage;
  statusName: string;
  resultName: string;
  executionResultName: string;
  validatorsAgreed: number;
  validatorsTotal: number;
};

export function hasContractConfig() {
  return Boolean(CONTRACT_ADDRESS);
}

export function readClient() {
  if (readClientCache) return readClientCache;
  readClientCache = createClient({
    chain: CHAIN,
    account: createAccount(generatePrivateKey())
  });
  return readClientCache;
}

export async function readContract<T>(functionName: string, args: unknown[] = []): Promise<T> {
  if (!CONTRACT_ADDRESS) {
    throw new Error("Bradbury contract address is not set in frontend/.env.");
  }
  return enqueueRead(() =>
    withReadRetry(
      () =>
        readClient().readContract({
          address: CONTRACT_ADDRESS,
          functionName,
          args: args as never
        } as never) as Promise<T>
    )
  );
}

export function makeWalletClient(provider: Eip1193Provider, address: string) {
  const client = createClient({
    chain: CHAIN,
    account: address as `0x${string}`,
    provider: provider as never
  } as never) as ReturnType<typeof createClient> & {
    __signalStakeProvider?: Eip1193Provider;
    __signalStakeAddress?: string;
  };

  client.__signalStakeProvider = provider;
  client.__signalStakeAddress = address;
  return client;
}

export async function ensureBradburyNetwork(provider: Eip1193Provider) {
  const chainIdHex = `0x${CHAIN.id.toString(16)}`;
  const currentChainId = await provider.request({ method: "eth_chainId" });
  if (typeof currentChainId === "string" && currentChainId.toLowerCase() === chainIdHex) {
    bradburyNetworkSynced = true;
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }]
    });
    bradburyNetworkSynced = true;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && Number(error.code) === 4902) {
      await addOrUpdateBradburyNetwork(provider);
      bradburyNetworkSynced = true;
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }]
      });
      return;
    }
    throw error;
  }
}

async function addOrUpdateBradburyNetwork(provider: Eip1193Provider) {
  const chainIdHex = `0x${CHAIN.id.toString(16)}`;
  try {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: CHAIN.name,
          nativeCurrency: CHAIN.nativeCurrency,
          rpcUrls: CHAIN.rpcUrls.default.http,
          blockExplorerUrls: [CHAIN.blockExplorers?.default.url ?? EXPLORER]
        }
      ]
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && Number(error.code) === 4001) {
      throw error;
    }
    // Existing wallets may reject duplicate chain updates. Switching below still verifies the chain id.
  }
}

export async function writeContract(
  client: ReturnType<typeof createClient> & {
    __signalStakeProvider?: Eip1193Provider;
    __signalStakeAddress?: string;
  },
  functionName: string,
  args: unknown[] = [],
  value: bigint = 0n
) {
  if (client.__signalStakeProvider && client.__signalStakeAddress) {
    return sendBrowserWriteTransaction(client.__signalStakeProvider, client.__signalStakeAddress, functionName, args, value);
  }

  const request = {
    address: CONTRACT_ADDRESS,
    functionName,
    args: args as never
  } as {
    address: string;
    functionName: string;
    args: never;
    value?: bigint;
  };

  if (value > 0n) {
    request.value = value;
  }

  return client.writeContract(request as never);
}

async function sendBrowserWriteTransaction(
  provider: Eip1193Provider,
  walletAddress: string,
  functionName: string,
  args: unknown[],
  value: bigint
) {
  const consensusAddress = CHAIN.consensusMainContract?.address;
  const consensusAbi = CHAIN.consensusMainContract?.abi;
  if (!consensusAddress || !consensusAbi) {
    throw new Error("Bradbury consensus contract is not configured in genlayer-js.");
  }

  const txRequest: Record<string, string> = {
    from: walletAddress,
    to: consensusAddress,
    data: getAddTransactionData(walletAddress, functionName, args).primary,
    value: `0x${value.toString(16)}`
  };

  try {
    const gas = await provider.request({ method: "eth_estimateGas", params: [txRequest] });
    if (typeof gas === "string") {
      const estimatedGas = BigInt(gas);
      txRequest.gas = `0x${(estimatedGas * 2n + 100_000n).toString(16)}`;
    }
  } catch {
    // Let the wallet estimate gas if Bradbury RPC estimation is unavailable.
  }

  try {
    const gasPrice = await provider.request({ method: "eth_gasPrice" });
    if (typeof gasPrice === "string") {
      txRequest.type = "0x0";
      txRequest.gasPrice = gasPrice;
    }
  } catch {
    // Some wallet providers populate pricing fields themselves.
  }

  let evmTxHash: unknown;
  try {
    evmTxHash = await provider.request({ method: "eth_sendTransaction", params: [txRequest] });
  } catch (error) {
    if (isUserRejected(error)) throw error;
    const fallback = getAddTransactionData(walletAddress, functionName, args).fallback;
    if (!fallback || fallback === txRequest.data) throw error;
    evmTxHash = await provider.request({ method: "eth_sendTransaction", params: [{ ...txRequest, data: fallback }] });
  }
  if (typeof evmTxHash !== "string") {
    throw new Error("Wallet did not return a transaction hash.");
  }

  return extractGenlayerTxId(evmTxHash).catch(() => evmTxHash);
}

function getAddTransactionData(walletAddress: string, functionName: string, args: unknown[]) {
  const inputCount = getAddTransactionAbi(true)[0].inputs?.length ?? 0;
  return inputCount >= 6
    ? {
        primary: encodeAddTransaction(walletAddress, functionName, args, true),
        fallback: encodeAddTransaction(walletAddress, functionName, args, false)
      }
    : {
        primary: encodeAddTransaction(walletAddress, functionName, args, false),
        fallback: null
      };
}

function encodeAddTransaction(walletAddress: string, functionName: string, args: unknown[], includeValidUntil: boolean) {
  const encodedArgs = getConsensusAddTransactionArgs(walletAddress, functionName, args);
  const finalArgs = includeValidUntil ? [...encodedArgs, BigInt(Math.floor(Date.now() / 1000) + 3600)] : encodedArgs;
  return (encodeFunctionData as (input: { abi: unknown[]; functionName: string; args: unknown[] }) => string)({
    abi: getAddTransactionAbi(includeValidUntil) as unknown[],
    functionName: "addTransaction",
    args: finalArgs
  });
}

function getAddTransactionAbi(includeValidUntil: boolean) {
  const addTransaction = ((CHAIN.consensusMainContract?.abi ?? []) as ContractAbiEntry[]).find(
    (entry) => entry.type === "function" && entry.name === "addTransaction"
  );
  if (!addTransaction?.inputs) {
    throw new Error("Bradbury addTransaction ABI is not available.");
  }

  return [
    {
      ...addTransaction,
      inputs: includeValidUntil ? addTransaction.inputs : addTransaction.inputs.slice(0, 5)
    }
  ];
}

function getConsensusAddTransactionArgs(walletAddress: string, functionName: string, args: unknown[]) {
  const calldata = buildConsensusTransactionData(functionName, args);

  return [
    walletAddress,
    CONTRACT_ADDRESS,
    BigInt(CHAIN.defaultNumberOfInitialValidators ?? 5),
    BigInt(CHAIN.defaultConsensusMaxRotations ?? 3),
    calldata
  ];
}

function isUserRejected(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && Number(error.code) === 4001;
}

function buildConsensusTransactionData(functionName: string, args: unknown[]) {
  const callData = genlayerAbi.calldata.encode(
    genlayerAbi.calldata.makeCalldataObject(functionName, args as never, undefined)
  );
  return genlayerAbi.transactions.serialize([callData, false]);
}

async function extractGenlayerTxId(evmTxHash: string) {
  const publicClient = createPublicClient({
    transport: http(CHAIN.rpcUrls.default.http[0])
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: evmTxHash as `0x${string}` });
  if (receipt.status === "reverted") {
    throw new Error(`Transaction reverted on Bradbury EVM: ${evmTxHash}`);
  }
  return extractGenlayerTxIdFromLogs(receipt.logs) ?? evmTxHash;
}

function extractGenlayerTxIdFromLogs(logs: Array<{ address?: string; topics?: string[] }>) {
  const createdTxAbi = [
    {
      anonymous: false,
      inputs: [
        { indexed: true, internalType: "bytes32", name: "txId", type: "bytes32" },
        { indexed: false, internalType: "uint256", name: "txSlot", type: "uint256" }
      ],
      name: "CreatedTransaction",
      type: "event"
    }
  ] as const;

  try {
    const events = parseEventLogs({ abi: createdTxAbi, eventName: "CreatedTransaction", logs: logs as never });
    const txId = events[0]?.args?.txId;
    if (typeof txId === "string") return txId;
  } catch {
    // Fall back to topic scanning below.
  }

  const consensusAddress = CHAIN.consensusMainContract?.address?.toLowerCase();
  const isTxIdCandidate = (value: string) =>
    /^0x[0-9a-fA-F]{64}$/.test(value) && !/^0x0{64}$/i.test(value) && !/^0x0{24}[0-9a-fA-F]{40}$/i.test(value);

  for (const log of logs) {
    if (String(log.address ?? "").toLowerCase() !== consensusAddress) continue;
    const candidate = log.topics?.[1];
    if (candidate && isTxIdCandidate(candidate)) return candidate;
  }

  return null;
}

export async function waitAccepted(client: ReturnType<typeof createClient>, hash: string) {
  let lastStatus: TxStatus | null = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const status = await getTransactionStatus(hash);
    lastStatus = status;
    if (status.stage === "failed") {
      throw new Error(
        `Bradbury accepted the transaction but execution failed: ${status.executionResultName || status.resultName || status.statusName}`
      );
    }
    if (status.executionResultName === "FINISHED_WITH_RETURN" || (!status.executionResultName && status.resultName === "AGREE")) {
      return status;
    }
    await sleep(3000);
  }
  throw new Error(
    `Bradbury accepted the transaction but no successful execution result was returned yet: ${
      lastStatus?.executionResultName || lastStatus?.resultName || lastStatus?.statusName || "UNKNOWN"
    }`
  );
}

export async function getTransactionStatus(hash: string): Promise<TxStatus> {
  const evmStatus = await getEvmReceiptStatus(hash);
  if (evmStatus === "reverted") {
    return {
      stage: "failed",
      statusName: "EVM_REVERTED",
      resultName: "REVERTED",
      executionResultName: "EVM_REVERTED",
      validatorsAgreed: 0,
      validatorsTotal: 0
    };
  }

  const tx = (await readClient().getTransaction({
    hash: hash as never
  } as never)) as {
    consensus_data?: { leader_receipt?: Array<{ validatorVotesName?: string[]; roundValidators?: unknown[] }> };
    lastRound?: { validatorVotesName?: string[]; roundValidators?: unknown[] };
    status?: string;
    status_name?: string;
    statusName?: string;
    result_name?: string;
    resultName?: string;
    txExecutionResultName?: string;
  };

  const round = tx.consensus_data?.leader_receipt?.[0] ?? tx.lastRound ?? null;
  const votes = round?.validatorVotesName ?? [];
  const validatorsTotal = Math.max(votes.length, round?.roundValidators?.length ?? 5);
  const validatorsAgreed = votes.filter((vote) => vote === "AGREE").length;
  const statusName = String(tx.status_name ?? tx.statusName ?? tx.status ?? "PENDING").toUpperCase();
  const resultName = String(tx.result_name ?? tx.resultName ?? "").toUpperCase();
  const executionResultName = String(tx.txExecutionResultName ?? "").toUpperCase();
  const hasExecutionFailure =
    executionResultName.includes("ERROR") ||
    executionResultName.includes("REVERT") ||
    executionResultName.includes("FAILED");

  let stage: TxStage = "pending";
  if (hasExecutionFailure || resultName.includes("ERROR") || resultName.includes("REVERT") || resultName.includes("FAILED")) stage = "failed";
  else if (statusName.includes("UNDETERMINED") || statusName.includes("CANCELED")) stage = "failed";
  else if (statusName.includes("FINALIZED") && (executionResultName === "FINISHED_WITH_RETURN" || resultName === "AGREE")) stage = "finalized";
  else if (statusName.includes("ACCEPTED") && (executionResultName === "FINISHED_WITH_RETURN" || resultName === "AGREE")) stage = "accepted";

  return { stage, statusName, resultName, executionResultName, validatorsAgreed, validatorsTotal };
}

async function getEvmReceiptStatus(hash: string) {
  try {
    const publicClient = createPublicClient({
      transport: http(CHAIN.rpcUrls.default.http[0])
    });
    const receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` });
    return receipt.status;
  } catch {
    return null;
  }
}

export function explorerTx(hash: string) {
  return `${EXPLORER}/tx/${hash}`;
}

export function explorerContract(address = CONTRACT_ADDRESS) {
  return `${EXPLORER}/address/${address}`;
}

function enqueueRead<T>(fn: () => Promise<T>): Promise<T> {
  const run = readQueue.then(fn, fn);
  readQueue = run.then(
    () => sleep(140),
    () => sleep(140)
  );
  return run;
}

async function withReadRetry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index < tries; index += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || index === tries - 1) throw error;
      await sleep(600 * 2 ** index + Math.random() * 250);
    }
  }
  throw lastError;
}

function isRateLimitError(error: unknown) {
  const message = String(
    typeof error === "object" && error
      ? `${"message" in error ? error.message : ""} ${"shortMessage" in error ? error.shortMessage : ""}`
      : error
  ).toLowerCase();
  return message.includes("rate limit") || message.includes("too many") || message.includes("429") || message.includes("-32429");
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}
