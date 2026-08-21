import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { createPublicClient, http } from "viem";

declare global {
  interface Window {
    __VERDICTPROOF_CONFIG__?: {
      contractAddress?: string;
      chain?: string;
      explorer?: string;
      rubricVersion?: string;
      reviewTransactions?: Record<string, string>;
    };
  }
}

const runtimeConfig = typeof window === "undefined" ? undefined : window.__VERDICTPROOF_CONFIG__;

export const CONTRACT_ADDRESS = runtimeConfig?.contractAddress || import.meta.env.VITE_VERDICTPROOF_CONTRACT_ADDRESS || "";
export const EXPLORER =
  runtimeConfig?.explorer || import.meta.env.VITE_GENLAYER_EXPLORER || "https://explorer-bradbury.genlayer.com";
export const CHAIN = testnetBradbury;
export const RUBRIC_VERSION = runtimeConfig?.rubricVersion || "VERDICTPROOF_V2_4";
export const REVIEW_TRANSACTIONS = runtimeConfig?.reviewTransactions ?? {};

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

let readClientCache: ReturnType<typeof createClient> | null = null;
let readQueue = Promise.resolve();

export type TxStage = "pending" | "accepted" | "finalized" | "failed";

export type TxStatus = {
  stage: TxStage;
  statusName: string;
  resultName: string;
  executionResultName: string;
  validatorsAgreed: number;
  validatorsTotal: number;
  rotationsLeft?: number;
  recipient?: string;
  functionName?: string;
};

export function isVerifiedReviewTransaction(status: TxStatus) {
  return (
    status.stage === "finalized" &&
    status.resultName === "AGREE" &&
    status.executionResultName === "FINISHED_WITH_RETURN" &&
    status.recipient?.toLowerCase() === CONTRACT_ADDRESS.toLowerCase() &&
    status.functionName === "evaluate_submission"
  );
}

export class TransactionPendingError extends Error {
  status: TxStatus | null;

  constructor(status: TxStatus | null) {
    super(`Transaction is still pending on Bradbury: ${status?.statusName || "UNKNOWN"}`);
    this.name = "TransactionPendingError";
    this.status = status;
  }
}

export function isTransactionPendingError(error: unknown): error is TransactionPendingError {
  return error instanceof TransactionPendingError;
}

export function hasContractConfig() {
  return Boolean(CONTRACT_ADDRESS);
}

export function readClient() {
  if (readClientCache) return readClientCache;
  readClientCache = createClient({
    chain: CHAIN
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
          args: args as never,
          stateStatus: "finalized"
        } as never) as Promise<T>
    )
  );
}

export function makeWalletClient(provider: Eip1193Provider, address: string) {
  return createClient({
    chain: CHAIN,
    account: address as `0x${string}`,
    provider: provider as never
  } as never);
}

export async function ensureBradburyNetwork(provider: Eip1193Provider) {
  const chainIdHex = `0x${CHAIN.id.toString(16)}`;
  const currentChainId = await provider.request({ method: "eth_chainId" });
  if (typeof currentChainId === "string" && currentChainId.toLowerCase() === chainIdHex) {
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }]
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && Number(error.code) === 4902) {
      await addOrUpdateBradburyNetwork(provider);
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
  client: ReturnType<typeof createClient>,
  functionName: string,
  args: unknown[] = [],
  value: bigint = 0n
) {
  return client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args: args as never,
    value
  } as never);
}

export async function waitAccepted(hash: string, maxAttempts = 80) {
  let lastStatus: TxStatus | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await getTransactionStatus(hash);
    lastStatus = status;
    if (status.stage === "failed") {
      throw new Error(
        `Bradbury accepted the transaction but execution failed: ${status.executionResultName || status.resultName || status.statusName}`
      );
    }
    if ((status.stage === "accepted" || status.stage === "finalized") && status.executionResultName === "FINISHED_WITH_RETURN") {
      return status;
    }
    if (attempt < maxAttempts - 1) await sleep(3000);
  }
  throw new TransactionPendingError(lastStatus);
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
    consensus_data?: { leader_receipt?: Array<{ validatorVotesName?: string[]; roundValidators?: unknown[]; method?: string }> };
    lastRound?: { validatorVotesName?: string[]; roundValidators?: unknown[]; method?: string; rotationsLeft?: number | bigint };
    status?: string;
    status_name?: string;
    statusName?: string;
    result_name?: string;
    resultName?: string;
    txExecutionResultName?: string;
    recipient?: string;
    to_address?: string;
    data?: { function_name?: string };
    txDataDecoded?: {
      callData?: Map<string, unknown> | Record<string, unknown>;
    };
  };

  const round = tx.lastRound ?? tx.consensus_data?.leader_receipt?.[0] ?? null;
  const votes = round?.validatorVotesName ?? [];
  const validatorsTotal = Math.max(votes.length, round?.roundValidators?.length ?? 0);
  const validatorsAgreed = votes.filter((vote) => vote === "AGREE").length;
  const rotationsLeft = Number(tx.lastRound?.rotationsLeft ?? 0);
  const statusName = String(tx.status_name ?? tx.statusName ?? tx.status ?? "PENDING").toUpperCase();
  const resultName = String(tx.result_name ?? tx.resultName ?? "").toUpperCase();
  const executionResultName = String(tx.txExecutionResultName ?? "").toUpperCase();
  const recipient = String(tx.recipient ?? tx.to_address ?? "");
  const decodedCallData = tx.txDataDecoded?.callData;
  const decodedMethod =
    decodedCallData instanceof Map
      ? decodedCallData.get("method")
      : decodedCallData && typeof decodedCallData === "object"
        ? decodedCallData.method
        : "";
  const functionName = String(decodedMethod ?? tx.data?.function_name ?? round?.method ?? "");
  const terminalLifecycle = statusName.includes("ACCEPTED") || statusName.includes("FINALIZED");
  const hasExecutionFailure =
    executionResultName.includes("ERROR") ||
    executionResultName.includes("REVERT") ||
    executionResultName.includes("FAILED");
  const hasConsensusFailure = terminalLifecycle && resultName !== "AGREE";

  let stage: TxStage = "pending";
  if (hasExecutionFailure || hasConsensusFailure || resultName.includes("ERROR") || resultName.includes("REVERT") || resultName.includes("FAILED")) stage = "failed";
  else if (
    statusName.includes("UNDETERMINED") ||
    statusName.includes("CANCELED") ||
    (statusName.includes("TIMEOUT") && rotationsLeft <= 0)
  ) stage = "failed";
  else if (statusName.includes("FINALIZED") && resultName === "AGREE" && executionResultName === "FINISHED_WITH_RETURN") stage = "finalized";
  else if (statusName.includes("ACCEPTED") && resultName === "AGREE" && executionResultName === "FINISHED_WITH_RETURN") stage = "accepted";

  return {
    stage,
    statusName,
    resultName,
    executionResultName,
    validatorsAgreed,
    validatorsTotal,
    rotationsLeft,
    ...(recipient ? { recipient } : {}),
    ...(functionName ? { functionName } : {})
  };
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
