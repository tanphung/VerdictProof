import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import App from "../src/App";

const readContract = vi.fn();
const writeContract = vi.fn();
const waitAccepted = vi.fn();
const getTransactionStatus = vi.fn();
const ensureBradburyNetwork = vi.fn();

vi.mock("../src/lib/genlayer", () => ({
  explorerContract: vi.fn(() => "https://explorer-bradbury.genlayer.com/address/0xfb7632B4BBe41D9fA986aE321e2BCAa1EeA2478a"),
  explorerTx: vi.fn((hash: string) => `https://explorer-bradbury.genlayer.com/tx/${hash}`),
  ensureBradburyNetwork: (...args: unknown[]) => ensureBradburyNetwork(...args),
  getTransactionStatus: (...args: unknown[]) => getTransactionStatus(...args),
  hasContractConfig: vi.fn(() => true),
  makeWalletClient: vi.fn((provider: unknown, address: string) => ({ provider, address })),
  readContract: (...args: unknown[]) => readContract(...args),
  waitAccepted: (...args: unknown[]) => waitAccepted(...args),
  writeContract: (...args: unknown[]) => writeContract(...args)
}));

type ChainCampaign = {
  campaign_id: number;
  owner: string;
  title: string;
  product_url: string;
  task_instruction: string;
  proof_requirement: string;
  reward_pool: string;
  reward_per_approved: string;
  stake_required: string;
  minimum_score: number;
  status: string;
  submission_count: number;
  approved_count: number;
  rejected_count: number;
};

const walletAddress = "0x9392F9ED67f8667fE555D2b919C9D84AeE8d3259";
const txHash = "0x77036cfee6607109364006f078ba2312ef27cf352e9a0f2cef3f420ed88ba36b";

let liveCampaigns: ChainCampaign[] = [];

function installWallet() {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_requestAccounts") return [walletAddress];
    if (method === "eth_accounts") return [];
    if (method === "eth_chainId") return "0x107d";
    return null;
  });

  Object.defineProperty(window, "ethereum", {
    configurable: true,
    value: {
      request,
      on: vi.fn(),
      removeListener: vi.fn()
    }
  });

  return request;
}

function uninstallWindowEthereum() {
  Object.defineProperty(window, "ethereum", {
    configurable: true,
    value: undefined
  });
}

function installLockedWallet() {
  Object.defineProperty(window, "ethereum", {
    configurable: true,
    value: {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [];
        if (method === "eth_chainId") return "0x107d";
        return null;
      }),
      on: vi.fn(),
      removeListener: vi.fn()
    }
  });
}

function installEip6963Wallet() {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_requestAccounts") return [walletAddress];
    if (method === "eth_accounts") return [];
    if (method === "eth_chainId") return "0x107d";
    return null;
  });

  const provider = {
    request,
    on: vi.fn(),
    removeListener: vi.fn()
  };

  window.addEventListener("eip6963:requestProvider", () => {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider } }));
  });

  return request;
}

function campaign(id = 1, title = "Checkout QA Campaign", submissionCount = 0): ChainCampaign {
  return {
    campaign_id: id,
    owner: walletAddress,
    title,
    product_url: "https://product.example/checkout",
    task_instruction: "Complete checkout and explain one concrete wallet confirmation issue.",
    proof_requirement: "Transaction URL, app result URL, written feedback.",
    reward_pool: "100000000000000000",
    reward_per_approved: "10000000000000000",
    stake_required: "10000000000000000",
    minimum_score: 75,
    status: "OPEN",
    submission_count: submissionCount,
    approved_count: 0,
    rejected_count: 0
  };
}

function fillCampaignForm(title = "Checkout QA Campaign") {
  fireEvent.change(screen.getByLabelText("Campaign title"), { target: { value: title } });
  fireEvent.change(screen.getByLabelText("Product URL"), { target: { value: "https://product.example/checkout" } });
  fireEvent.change(screen.getByLabelText("Task instruction"), {
    target: { value: "Complete checkout and explain one concrete wallet confirmation issue." }
  });
  fireEvent.change(screen.getByLabelText("Required proof description"), {
    target: { value: "Transaction URL, app result URL, written feedback." }
  });
}

describe("VerdictProof app live wallet flow", () => {
  beforeEach(() => {
    window.localStorage.clear();
    liveCampaigns = [];
    installWallet();
    ensureBradburyNetwork.mockResolvedValue(undefined);
    writeContract.mockResolvedValue(txHash);
    waitAccepted.mockImplementation(async () => {
      liveCampaigns = [campaign()];
    });
    getTransactionStatus.mockResolvedValue({
      stage: "accepted",
      statusName: "ACCEPTED",
      resultName: "AGREE",
      executionResultName: "FINISHED_WITH_RETURN",
      validatorsAgreed: 5,
      validatorsTotal: 5
    });
    readContract.mockImplementation(async (method: string) => {
      if (method === "list_campaigns") {
        return { campaigns: liveCampaigns, count: liveCampaigns.length, total: liveCampaigns.length };
      }
      if (method === "list_campaign_submissions") {
        return { submissions: [], count: 0 };
      }
      throw new Error(`Unexpected read method: ${method}`);
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows live empty state and a contract explorer link", async () => {
    render(<App />);

    expect(await screen.findByText("No live campaigns yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Explorer/i })).toHaveAttribute(
      "href",
      "https://explorer-bradbury.genlayer.com/address/0xfb7632B4BBe41D9fA986aE321e2BCAa1EeA2478a"
    );
  });

  it("connects the wallet inline without opening a wallet modal", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getAllByRole("button", { name: /Connect Wallet/i })[0]);

    expect(await screen.findByText("0x9392...3259")).toBeInTheDocument();
    expect(screen.queryByText("Wallet Connection")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Disconnect/i })).toBeInTheDocument();
  });

  it("shows wallet feedback from the claims view", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^Claims$/i }));
    await user.click(screen.getByRole("button", { name: /Connect Wallet/i }));

    expect(await screen.findByText("Wallet ready on Bradbury. Live campaigns refreshed.")).toBeInTheDocument();
  });

  it("explains when a detected wallet returns no account", async () => {
    const user = userEvent.setup();
    installLockedWallet();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^Claims$/i }));
    await user.click(screen.getByRole("button", { name: /Connect Wallet/i }));

    expect(
      await screen.findByText("The wallet did not return an account. Unlock it, approve account access for VerdictProof, then connect again.")
    ).toBeInTheDocument();
  });

  it("connects wallets announced through EIP-6963 provider discovery", async () => {
    const user = userEvent.setup();
    uninstallWindowEthereum();
    const request = installEip6963Wallet();
    render(<App />);

    await user.click(screen.getAllByRole("button", { name: /Connect Wallet/i })[0]);

    expect(await screen.findByText("0x9392...3259")).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    expect(screen.getByRole("button", { name: /Disconnect/i })).toBeInTheDocument();
  });

  it("creates a live campaign, tracks the tx, and reloads on-chain state", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getAllByRole("button", { name: /Connect Wallet/i })[0]);
    await screen.findByText("0x9392...3259");
    await user.click(await screen.findByRole("button", { name: /Create Live Campaign/i }));
    fillCampaignForm();
    await user.click(screen.getByRole("button", { name: /Create & Fund Campaign/i }));

    await waitFor(() => {
      expect(writeContract).toHaveBeenCalledWith(
        expect.anything(),
        "create_campaign",
        [
          "Checkout QA Campaign",
          "https://product.example/checkout",
          "Complete checkout and explain one concrete wallet confirmation issue.",
          "Transaction URL, app result URL, written feedback.",
          100000000000000000n,
          10000000000000000n,
          10000000000000000n,
          75n
        ],
        100000000000000000n
      );
    });

    expect(await screen.findAllByText("Checkout QA Campaign")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /View transaction/i })).toHaveAttribute(
      "href",
      `https://explorer-bradbury.genlayer.com/tx/${txHash}`
    );
    expect(screen.getByText("Accepted")).toBeInTheDocument();
  });

  it("keeps the transaction link after a page reload", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getAllByRole("button", { name: /Connect Wallet/i })[0]);
    await screen.findByText("0x9392...3259");
    await user.click(await screen.findByRole("button", { name: /Create Live Campaign/i }));
    fillCampaignForm();
    await user.click(screen.getByRole("button", { name: /Create & Fund Campaign/i }));
    await screen.findByRole("link", { name: /View transaction/i });

    cleanup();
    render(<App />);

    expect(await screen.findByRole("link", { name: /View transaction/i })).toHaveAttribute(
      "href",
      `https://explorer-bradbury.genlayer.com/tx/${txHash}`
    );
  });

  it("selects the newly created campaign instead of leaving an old pending submission open", async () => {
    const user = userEvent.setup();
    const oldCampaign = campaign(1, "Old campaign with proof", 1);
    const newCampaign = campaign(2, "Checkout QA Campaign", 0);
    liveCampaigns = [oldCampaign];

    waitAccepted.mockImplementation(async () => {
      liveCampaigns = [oldCampaign, newCampaign];
    });
    readContract.mockImplementation(async (method: string, args?: unknown[]) => {
      if (method === "list_campaigns") {
        return { campaigns: liveCampaigns, count: liveCampaigns.length, total: liveCampaigns.length };
      }
      if (method === "list_campaign_submissions") {
        const campaignId = Number(args?.[0] ?? 0);
        if (campaignId === 1) {
          return {
            submissions: [
              {
                submission_id: 1,
                campaign_id: 1,
                tester: walletAddress,
                transaction_url: "https://example.com/tx/old",
                app_result_url: "https://example.com/result/old",
                feedback_text: "Old pending feedback",
                stake_amount: "10000000000000000",
                status: "PENDING",
                score: 0,
                approved: false,
                reward_amount: "0",
                reason_summary: "Awaiting GenLayer AI review.",
                claimed: false
              }
            ],
            count: 1
          };
        }
        return { submissions: [], count: 0 };
      }
      throw new Error(`Unexpected read method: ${method}`);
    });

    render(<App />);

    expect(await screen.findAllByText("Old campaign with proof")).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: /Connect Wallet/i })[0]);
    await screen.findByRole("button", { name: /Disconnect/i });
    await user.click(screen.getAllByRole("button", { name: /^Create Campaign$/i })[0]);
    fillCampaignForm();
    await user.click(screen.getByRole("button", { name: /Create & Fund Campaign/i }));

    expect(await screen.findByText("Campaign #2")).toBeInTheDocument();
    expect(screen.getByText("No submissions yet")).toBeInTheDocument();
  });
});
