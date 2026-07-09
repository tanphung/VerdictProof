import { decodeFunctionData } from "viem";
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
    vi.stubEnv("VITE_SIGNALSTAKE_CONTRACT_ADDRESS", "0xfb7632B4BBe41D9fA986aE321e2BCAa1EeA2478a");
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
      args: [0n, 50n]
    });
  });

  it("encodes browser wallet writes with the six-argument Bradbury addTransaction ABI", async () => {
    const { makeWalletClient, writeContract } = await import("../src/lib/genlayer");
    const sentTransactions: Array<Record<string, string>> = [];
    const provider = {
      request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === "eth_estimateGas") return "0x5208";
        if (method === "eth_gasPrice") return "0x1";
        if (method === "eth_sendTransaction") {
          sentTransactions.push((params?.[0] ?? {}) as Record<string, string>);
          return `0x${"a".repeat(64)}`;
        }
        return null;
      })
    };

    const client = makeWalletClient(provider, "0x1234567890123456789012345678901234567890");
    const result = await writeContract(client, "create_campaign", ["Title"], 10n);

    expect(result).toBe(`0x${"a".repeat(64)}`);
    expect(sentTransactions).toHaveLength(1);
    const decoded = decodeFunctionData({
      abi: addTransactionAbi,
      data: sentTransactions[0].data as `0x${string}`
    });
    expect(decoded.functionName).toBe("addTransaction");
    expect(decoded.args ?? []).toHaveLength(6);
    expect(typeof decoded.args?.[5]).toBe("bigint");
  });

  it("parses transaction status and validator agreement", async () => {
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
      stage: "accepted",
      statusName: "ACCEPTED",
      resultName: "AGREE",
      executionResultName: "",
      validatorsAgreed: 2,
      validatorsTotal: 5
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
});
