import { vi } from "vitest";

const readContractMock = vi.fn();
const writeContractMock = vi.fn();
const waitForTransactionReceipt = vi.fn();
const getTransaction = vi.fn();
const waitForTransactionReceiptViem = vi.fn();
const addTransactionAbi = vi.hoisted(
  () =>
    [
      {
        inputs: [
          { internalType: "address", name: "_sender", type: "address" },
          { internalType: "address", name: "_recipient", type: "address" },
          { internalType: "uint256", name: "_numOfInitialValidators", type: "uint256" },
          { internalType: "uint256", name: "_maxRotations", type: "uint256" },
          { internalType: "bytes", name: "_calldata", type: "bytes" },
          { internalType: "uint256", name: "_validUntil", type: "uint256" }
        ],
        name: "addTransaction",
        outputs: [],
        stateMutability: "payable",
        type: "function"
      }
    ] as const
);

vi.mock("genlayer-js", () => ({
  abi: {
    calldata: {
      makeCalldataObject: vi.fn((functionName, args) => ({ functionName, args })),
      encode: vi.fn(() => "0xabcd")
    },
    transactions: {
      serialize: vi.fn(() => "0x1234")
    }
  },
  createAccount: vi.fn(() => ({ address: "0x0000000000000000000000000000000000000001" })),
  createClient: vi.fn(() => ({
    readContract: readContractMock,
    writeContract: writeContractMock,
    waitForTransactionReceipt,
    getTransaction
  })),
  generatePrivateKey: vi.fn(() => "0x1111111111111111111111111111111111111111111111111111111111111111")
}));

vi.mock("genlayer-js/chains", () => ({
  testnetBradbury: {
    id: 4221,
    name: "GenLayer Bradbury Testnet",
    nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc-bradbury.genlayer.com"] } },
    blockExplorers: { default: { url: "https://explorer-bradbury.genlayer.com" } },
    consensusMainContract: { address: "0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D", abi: addTransactionAbi },
    defaultNumberOfInitialValidators: 5,
    defaultConsensusMaxRotations: 3
  }
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      waitForTransactionReceipt: waitForTransactionReceiptViem
    }))
  };
});

describe("genlayer frontend helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_VERDICTPROOF_CONTRACT_ADDRESS", "0xfb7632B4BBe41D9fA986aE321e2BCAa1EeA2478a");
    vi.stubEnv("VITE_GENLAYER_EXPLORER", "https://explorer-bradbury.genlayer.com");
    readContractMock.mockReset();
    writeContractMock.mockReset();
    waitForTransactionReceipt.mockReset();
    getTransaction.mockReset();
    waitForTransactionReceiptViem.mockReset();
    waitForTransactionReceiptViem.mockResolvedValue({ status: "success", logs: [] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("switches an injected wallet to Bradbury when needed", async () => {
    const { ensureBradburyNetwork } = await import("../src/lib/genlayer");
    const request = vi
      .fn()
      .mockResolvedValueOnce("0x1")
      .mockResolvedValueOnce(null);

    await ensureBradburyNetwork({ request });

    expect(request).toHaveBeenCalledWith({ method: "eth_chainId" });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "wallet_addEthereumChain" }));
    expect(request).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x107d" }]
    });
  });

  it("adds Bradbury then switches when the chain is missing", async () => {
    const { ensureBradburyNetwork } = await import("../src/lib/genlayer");
    const request = vi
      .fn()
      .mockResolvedValueOnce("0x1")
      .mockRejectedValueOnce({ code: 4902 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await ensureBradburyNetwork({ request });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "wallet_addEthereumChain"
      })
    );
    expect(request).toHaveBeenLastCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x107d" }]
    });
  });

  it("wraps contract reads with configured contract address", async () => {
    const { readContract } = await import("../src/lib/genlayer");
    readContractMock.mockResolvedValueOnce({ count: 0 });

    await readContract("list_campaigns", [0n, 50n]);

    expect(readContractMock).toHaveBeenCalledWith({
      address: "0xfb7632B4BBe41D9fA986aE321e2BCAa1EeA2478a",
      functionName: "list_campaigns",
      args: [0n, 50n],
      stateStatus: "finalized"
    });
  });

  it("uses the official GenLayer client for browser wallet writes", async () => {
    const { makeWalletClient, writeContract } = await import("../src/lib/genlayer");
    const provider = { request: vi.fn() };
    writeContractMock.mockResolvedValueOnce(`0x${"a".repeat(64)}`);

    const client = makeWalletClient(provider, "0x1234567890123456789012345678901234567890");
    const result = await writeContract(client, "create_campaign", ["Title"], 10n);

    expect(result).toBe(`0x${"a".repeat(64)}`);
    expect(writeContractMock).toHaveBeenCalledWith({
      address: "0xfb7632B4BBe41D9fA986aE321e2BCAa1EeA2478a",
      functionName: "create_campaign",
      args: ["Title"],
      value: 10n
    });
  });

  it("requires finalized AGREE metadata before showing a review hash", async () => {
    const { isVerifiedReviewTransaction } = await import("../src/lib/genlayer");
    const base = {
      stage: "finalized" as const,
      statusName: "FINALIZED",
      resultName: "AGREE",
      executionResultName: "FINISHED_WITH_RETURN",
      validatorsAgreed: 5,
      validatorsTotal: 5,
      recipient: "0xfb7632B4BBe41D9fA986aE321e2BCAa1EeA2478a",
      functionName: "evaluate_submission"
    };

    expect(isVerifiedReviewTransaction(base)).toBe(true);
    expect(isVerifiedReviewTransaction({ ...base, stage: "accepted" })).toBe(false);
    expect(isVerifiedReviewTransaction({ ...base, recipient: "0x0000000000000000000000000000000000000000" })).toBe(false);
    expect(isVerifiedReviewTransaction({ ...base, functionName: "claim_reward" })).toBe(false);
  });

  it("keeps validator agreement pending until execution succeeds", async () => {
    const { getTransactionStatus } = await import("../src/lib/genlayer");
    getTransaction.mockResolvedValueOnce({
      status_name: "ACCEPTED",
      result_name: "AGREE",
      consensus_data: {
        leader_receipt: [
          {
            validatorVotesName: ["AGREE", "AGREE", "DISAGREE"],
            roundValidators: ["a", "b", "c", "d", "e"]
          }
        ]
      }
    });

    const status = await getTransactionStatus("0xhash");

    expect(status).toEqual({
      stage: "pending",
      statusName: "ACCEPTED",
      resultName: "AGREE",
      executionResultName: "",
      validatorsAgreed: 2,
      validatorsTotal: 5,
      rotationsLeft: 0
    });
  });

  it("does not invent a validator total when Bradbury omits vote metadata", async () => {
    const { getTransactionStatus } = await import("../src/lib/genlayer");
    getTransaction.mockResolvedValueOnce({
      status_name: "FINALIZED",
      result_name: "AGREE",
      txExecutionResultName: "FINISHED_WITH_RETURN",
      recipient: "0xfb7632B4BBe41D9fA986aE321e2BCAa1EeA2478a",
      data: { function_name: "evaluate_submission" }
    });

    const status = await getTransactionStatus("0xhash");

    expect(status.validatorsAgreed).toBe(0);
    expect(status.validatorsTotal).toBe(0);
  });

  it("accepts only a finished contract execution", async () => {
    const { getTransactionStatus } = await import("../src/lib/genlayer");
    getTransaction.mockResolvedValueOnce({
      status_name: "ACCEPTED",
      result_name: "AGREE",
      txExecutionResultName: "FINISHED_WITH_RETURN"
    });

    const status = await getTransactionStatus("0xhash");

    expect(status.stage).toBe("accepted");
    expect(status.executionResultName).toBe("FINISHED_WITH_RETURN");
  });

  it("extracts the reviewed contract and method from Bradbury decoded calldata", async () => {
    const { getTransactionStatus } = await import("../src/lib/genlayer");
    getTransaction.mockResolvedValueOnce({
      statusName: "FINALIZED",
      resultName: "AGREE",
      txExecutionResultName: "FINISHED_WITH_RETURN",
      recipient: "0x4BFE31d4afcB4879aB5f9Acf9144Ff67039F6738",
      txDataDecoded: {
        callData: new Map<string, unknown>([
          ["args", [3n]],
          ["method", "evaluate_submission"]
        ])
      }
    });

    const status = await getTransactionStatus("0xreview");

    expect(status).toMatchObject({
      stage: "finalized",
      recipient: "0x4BFE31d4afcB4879aB5f9Acf9144Ff67039F6738",
      functionName: "evaluate_submission"
    });
  });

  it("treats accepted execution errors as failed transactions", async () => {
    const { getTransactionStatus, readClient, waitAccepted } = await import("../src/lib/genlayer");
    getTransaction.mockResolvedValue({
      status_name: "ACCEPTED",
      result_name: "AGREE",
      txExecutionResultName: "ERROR"
    });
    waitForTransactionReceipt.mockResolvedValueOnce({});

    await expect(waitAccepted(readClient(), "0xhash")).rejects.toThrow("execution failed");

    const status = await getTransactionStatus("0xhash");
    expect(status.stage).toBe("failed");
    expect(status.statusName).toBe("ACCEPTED");
    expect(status.resultName).toBe("AGREE");
    expect(status.executionResultName).toBe("ERROR");
  });

  it("treats finalized no-majority consensus as failed", async () => {
    const { getTransactionStatus } = await import("../src/lib/genlayer");
    getTransaction.mockResolvedValueOnce({
      status_name: "FINALIZED",
      result_name: "NO_MAJORITY",
      txExecutionResultName: "FINISHED_WITH_RETURN"
    });

    const status = await getTransactionStatus("0xhash");

    expect(status.stage).toBe("failed");
    expect(status.statusName).toBe("FINALIZED");
    expect(status.resultName).toBe("NO_MAJORITY");
  });

  it("does not accept a terminal validator-timeout result", async () => {
    const { getTransactionStatus } = await import("../src/lib/genlayer");
    getTransaction.mockResolvedValueOnce({
      status_name: "ACCEPTED",
      result_name: "VALIDATORS_TIMEOUT",
      txExecutionResultName: "FINISHED_WITH_RETURN"
    });

    const status = await getTransactionStatus("0xhash");

    expect(status.stage).toBe("failed");
    expect(status.resultName).toBe("VALIDATORS_TIMEOUT");
  });

  it("stops pending UI for a validator-timeout lifecycle", async () => {
    const { getTransactionStatus } = await import("../src/lib/genlayer");
    getTransaction.mockResolvedValueOnce({
      status_name: "VALIDATORS_TIMEOUT",
      result_name: "TIMEOUT",
      txExecutionResultName: "FINISHED_WITH_RETURN",
      lastRound: { rotationsLeft: 0 }
    });

    const status = await getTransactionStatus("0xhash");

    expect(status.stage).toBe("failed");
    expect(status.statusName).toBe("VALIDATORS_TIMEOUT");
  });

  it("keeps a validator timeout pending while Bradbury still has rotations", async () => {
    const { getTransactionStatus } = await import("../src/lib/genlayer");
    getTransaction.mockResolvedValueOnce({
      status_name: "LEADER_TIMEOUT",
      result_name: "IDLE",
      txExecutionResultName: "FINISHED_WITH_RETURN",
      lastRound: {
        rotationsLeft: 2,
        validatorVotesName: ["NOT_VOTED", "NOT_VOTED"],
        roundValidators: ["a", "b", "c", "d", "e"]
      }
    });

    const status = await getTransactionStatus("0xhash");

    expect(status.stage).toBe("pending");
    expect(status.rotationsLeft).toBe(2);
    expect(status.validatorsTotal).toBe(5);
  });

  it("distinguishes an unfinished poll window from transaction failure", async () => {
    const { readClient, waitAccepted } = await import("../src/lib/genlayer");
    getTransaction.mockResolvedValueOnce({
      status_name: "COMMITTING",
      result_name: "IDLE",
      txExecutionResultName: "NOT_VOTED"
    });

    await expect(waitAccepted(readClient(), "0xhash", 1)).rejects.toMatchObject({
      name: "TransactionPendingError"
    });
  });
});
