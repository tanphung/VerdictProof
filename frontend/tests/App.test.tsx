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
  CONTRACT_ADDRESS: "0xfb7632B4BBe41D9fA986aE321e2BCAa1EeA2478a",
  RUBRIC_VERSION: "VERDICTPROOF_V2_5_FULL_ASSURANCE",
  REVIEW_TRANSACTIONS: {},
  explorerContract: vi.fn(() => "https://explorer-bradbury.genlayer.com/address/0xfb7632B4BBe41D9fA986aE321e2BCAa1EeA2478a"),
  explorerTx: vi.fn((hash: string) => `https://explorer-bradbury.genlayer.com/tx/${hash}`),
  ensureBradburyNetwork: (...args: unknown[]) => ensureBradburyNetwork(...args),
  getTransactionStatus: (...args: unknown[]) => getTransactionStatus(...args),
  hasContractConfig: vi.fn(() => true),
  isVerifiedReviewTransaction: vi.fn((status: {
    stage: string;
    resultName: string;
    executionResultName: string;
    recipient?: string;
    functionName?: string;
  }) =>
    status.stage === "finalized" &&
    status.resultName === "AGREE" &&
    status.executionResultName === "FINISHED_WITH_RETURN" &&
    status.recipient?.toLowerCase() === "0xfb7632B4BBe41D9fA986aE321e2BCAa1EeA2478a".toLowerCase() &&
    status.functionName === "evaluate_submission"
  ),
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
  expired_count: number;
  reserved_reward_pool: string;
  available_reward_slots: number;
  revision: number;
  submission_deadline: number;
  review_timeout_seconds: number;
  obligations: Array<{ id: string; text: string }>;
  artifact_policy: Record<string, string>;
  receipt_policy: {
    source_contract: string;
    method: string;
    task_identifier: { selector: string; value: string };
    deal: { selector: string; value: string };
    recipient: { selector: string; value: string };
    amount_atto: { selector: string; value: string };
    kind: { selector: string; value: string };
    released: { selector: string; value: boolean };
  };
  repository_identity: Record<string, string>;
  close_settlement: null | Record<string, unknown>;
  rubric_version: string;
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
    proof_requirement: "Finalized transaction, immutable GitHub artifact, and written feedback.",
    reward_pool: "100000000000000000",
    reward_per_approved: "10000000000000000",
    stake_required: "10000000000000000",
    minimum_score: 75,
    status: "OPEN",
    submission_count: submissionCount,
    approved_count: 0,
    rejected_count: 0,
    expired_count: 0,
    reserved_reward_pool: "0",
    available_reward_slots: 10,
    revision: 1,
    submission_deadline: 1788307200,
    review_timeout_seconds: 86400,
    obligations: [{ id: "OBL-001", text: "Complete checkout." }, { id: "OBL-002", text: "Document the result." }],
    artifact_policy: { provider: "GITHUB", auth_mode: "GITHUB_API", owner: "tanphung", repository: "VerdictProof", path: "evidence/result.md", content_type: "text/markdown" },
    receipt_policy: {
      source_contract: "0xfb7632B4BBe41D9fA986aE321e2BCAa1EeA2478a",
      method: "release",
      task_identifier: { selector: "kwargs.task_identifier", value: "VP-CHECKOUT-001" },
      deal: { selector: "kwargs.deal_id", value: "DEAL-001" },
      recipient: { selector: "kwargs.recipient", value: walletAddress },
      amount_atto: { selector: "kwargs.amount_atto", value: "10000000000000000" },
      kind: { selector: "kwargs.kind", value: "RELEASE" },
      released: { selector: "kwargs.released", value: true }
    },
    repository_identity: { repository_id: "12345", repository_node_id: "R_node", owner_id: "6789", owner: "tanphung", repository: "VerdictProof", full_name: "tanphung/VerdictProof" },
    close_settlement: null,
    rubric_version: "VERDICTPROOF_V2_5_FULL_ASSURANCE"
  };
}

function reviewedSubmission() {
  return {
    submission_id: 1,
    campaign_id: 1,
    campaign_revision: 1,
    tester: walletAddress,
    transaction_url: `https://explorer-bradbury.genlayer.com/tx/${txHash}`,
    feedback_text: "Specific checkout feedback with a concrete wallet confirmation improvement.",
    stake_amount: "10000000000000000",
    status: "APPROVED",
    score: 88,
    approved: true,
    reward_amount: "10000000000000000",
    submitted_at: 1788134400,
    review_deadline: 1788220800,
    commit_sha: "a".repeat(40),
    artifact_key: `github://12345/${"a".repeat(40)}/evidence/result.md`,
    provenance_manifest: { canonical_origin: `github://12345/${"a".repeat(40)}/evidence/result.md`, repository_id: "12345", repository_node_id: "R_node", owner_id: "6789", owner: "tanphung", repository: "VerdictProof", commit_sha: "a".repeat(40), path: "evidence/result.md", content_type: "text/markdown", byte_length: 1500, blob_sha: "b".repeat(40), sha256: "c".repeat(64), total_chunks: 2, chunk_digests: ["d".repeat(64), "e".repeat(64)] },
    artifact_sha256: "c".repeat(64),
    artifact_byte_length: 1500,
    total_chunks: 2,
    chunk_digests: ["d".repeat(64), "e".repeat(64)],
    receipt_checks: { finalized_success: true, sender_match: true, source_contract_match: true, method_match: true, task_identifier_match: true, deal_match: true, recipient_match: true, amount_atto_match: true, kind_match: true, released_match: true, all_match: true },
    obligation_assessments: [
      { obligation_id: "OBL-001", verdict: "SATISFIED", evidence_id: "ARTIFACT_PRIMARY", chunk_citations: [0], reason_code: "ACTION_CONFIRMED" },
      { obligation_id: "OBL-002", verdict: "SATISFIED", evidence_id: "ARTIFACT_PRIMARY", chunk_citations: [1], reason_code: "STATE_DOCUMENTED" }
    ],
    reviewed_chunks: [0, 1],
    task_completed: true,
    usage_valid: true,
    proof_score: 40,
    feedback_score: 20,
    insight_score: 16,
    originality_score: 12,
    reason_summary: "Independent validators approved the submitted product evidence.",
    evidence_summary: "The receipt, sender, outcome page, and product feedback were checked independently.",
    improvement_recommendation: "Show the resulting campaign ID beside the final transaction.",
    risk_flags: "GOOD_SIGNAL",
    rubric_version: "VERDICTPROOF_V2_5_FULL_ASSURANCE",
    validation_method: "INDEPENDENT_FULL_ARTIFACT_COMPARATIVE",
    task_analysis: "The transaction method and rendered outcome prove the requested checkout campaign flow.",
    proof_reason: "Strong receipt, ownership, and outcome evidence.",
    feedback_reason: "Feedback names a specific wallet confirmation issue.",
    insight_reason: "The recommendation is actionable for the product owner.",
    originality_reason: "The observation is concrete and not generic boilerplate.",
    consensus_checks: "EXACT_EVIDENCE_GATES|EXACT_APPROVAL|TOTAL_SCORE_DELTA_12",
    settlement_explanation: "Stake is returned and the reserved campaign reward is unlocked.",
    evidence_transaction_hash: txHash,
    reserved_reward_amount: "10000000000000000",
    reservation_status: "CONSUMED",
    settlement_record: { status: "CLAIMABLE", kind: "CLAIM", recipient: walletAddress, amount_atto: "20000000000000000", released: false },
    claimed: false
  };
}

function fillCampaignForm(title = "Checkout QA Campaign") {
  fireEvent.change(screen.getByLabelText("Campaign title"), { target: { value: title } });
  fireEvent.change(screen.getByLabelText("Product URL"), { target: { value: "https://product.example/checkout" } });
  fireEvent.change(screen.getByLabelText("Source contract"), {
    target: { value: "0xfb7632B4BBe41D9fA986aE321e2BCAa1EeA2478a" }
  });
  fireEvent.change(screen.getByLabelText("Method"), { target: { value: "release" } });
  fireEvent.change(screen.getByLabelText("Task identifier"), { target: { value: "VP-CHECKOUT-001" } });
  fireEvent.change(screen.getByLabelText("Deal ID"), { target: { value: "DEAL-001" } });
  fireEvent.change(screen.getByLabelText("Recipient value"), { target: { value: walletAddress } });
  fireEvent.change(screen.getByLabelText("Amount atto"), { target: { value: "10000000000000000" } });
  fireEvent.change(screen.getByLabelText("Submission deadline"), { target: { value: "2026-09-02T00:00" } });
  fireEvent.change(screen.getByLabelText("Task instruction"), {
    target: { value: "Complete checkout and explain one concrete wallet confirmation issue." }
  });
  fireEvent.change(screen.getByLabelText("Required proof description"), {
    target: { value: "Finalized transaction, immutable GitHub artifact, and written feedback." }
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
      if (method === "get_evidence_usage") {
        return {
          transaction_hash: txHash,
          artifact_key: `github://12345/${"a".repeat(40)}/evidence/result.md`,
          transaction_submission_id: 0,
          artifact_submission_id: 0,
          available: true
        };
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

  it("labels contract-scoped cache as stale when finalized reads fail", async () => {
    const cached = campaign();
    window.localStorage.setItem(
      "verdictproof:bradbury:0xfb7632b4bbe41d9fa986ae321e2bcaa1eea2478a:VERDICTPROOF_V2_5_FULL_ASSURANCE:live-state",
      JSON.stringify({
        campaigns: [{
          campaignId: cached.campaign_id,
          owner: cached.owner,
          title: cached.title,
          productUrl: cached.product_url,
          taskInstruction: cached.task_instruction,
          proofRequirement: cached.proof_requirement,
          rewardPool: cached.reward_pool,
          rewardPerApproved: cached.reward_per_approved,
          stakeRequired: cached.stake_required,
          minimumScore: cached.minimum_score,
          status: cached.status,
          submissionCount: cached.submission_count,
          approvedCount: cached.approved_count,
          rejectedCount: cached.rejected_count,
          expiredCount: cached.expired_count,
          reservedRewardPool: cached.reserved_reward_pool,
          availableRewardSlots: cached.available_reward_slots,
          revision: cached.revision,
          submissionDeadline: cached.submission_deadline,
          reviewTimeoutSeconds: cached.review_timeout_seconds,
          obligations: cached.obligations,
          artifactPolicy: cached.artifact_policy,
          receiptPolicy: cached.receipt_policy,
          repositoryIdentity: cached.repository_identity,
          closeSettlement: cached.close_settlement,
          rubricVersion: cached.rubric_version,
          expectedSourceContract: cached.receipt_policy.source_contract,
          expectedMethod: cached.receipt_policy.method,
          expectedTaskIdentifier: cached.receipt_policy.task_identifier.value
        }],
        submissions: [],
        savedAt: Date.now()
      })
    );
    readContract.mockRejectedValue(new Error("Bradbury finalized read unavailable"));

    render(<App />);

    expect(await screen.findByText(/Cached data remains visible and may be stale/)).toBeInTheDocument();
    expect(screen.getAllByText("Checkout QA Campaign").length).toBeGreaterThan(0);
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
          "Finalized transaction, immutable GitHub artifact, and written feedback.",
          100000000000000000n,
          10000000000000000n,
          10000000000000000n,
          75n,
          expect.stringContaining('"schema":"VERDICTPROOF_POLICY_V1"')
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

  it("blocks consumed evidence before opening the wallet write", async () => {
    const user = userEvent.setup();
    liveCampaigns = [campaign()];
    readContract.mockImplementation(async (method: string) => {
      if (method === "list_campaigns") return { campaigns: liveCampaigns, count: 1, total: 1 };
      if (method === "list_campaign_submissions") return { submissions: [], count: 0 };
      if (method === "get_evidence_usage") {
        return {
          transaction_hash: txHash,
          artifact_key: `github://12345/${"a".repeat(40)}/evidence/result.md`,
          transaction_submission_id: 7,
          artifact_submission_id: 0,
          available: false
        };
      }
      throw new Error(`Unexpected read method: ${method}`);
    });

    render(<App />);
    await screen.findAllByText("Checkout QA Campaign");
    await user.click(screen.getAllByRole("button", { name: /Connect Wallet/i })[0]);
    await screen.findByText("0x9392...3259");
    fireEvent.change(screen.getByLabelText("Transaction URL"), {
      target: { value: `https://explorer-bradbury.genlayer.com/tx/${txHash}` }
    });
    fireEvent.change(screen.getByLabelText("Immutable Git commit SHA"), { target: { value: "a".repeat(40) } });
    fireEvent.change(screen.getByLabelText("Full artifact SHA-256"), { target: { value: "c".repeat(64) } });
    fireEvent.change(screen.getByLabelText("Artifact byte length"), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText("Feedback text"), {
      target: { value: "I completed checkout and documented a concrete wallet confirmation issue for the product team." }
    });
    const submitButton = screen.getByRole("button", { name: /Stake 0.01 GEN & Submit Proof/i });
    fireEvent.submit(submitButton.closest("form")!);

    expect(await screen.findByText("This evidence reference was already consumed by Submission #7.")).toBeInTheDocument();
    expect(writeContract).not.toHaveBeenCalledWith(expect.anything(), "submit_proof", expect.anything(), expect.anything());
  });

  it("renders a full on-chain validator report instead of a summary-only verdict", async () => {
    const user = userEvent.setup();
    liveCampaigns = [campaign(1, "Checkout QA Campaign", 1)];
    readContract.mockImplementation(async (method: string) => {
      if (method === "list_campaigns") {
        return { campaigns: liveCampaigns, count: 1, total: 1 };
      }
      if (method === "list_campaign_submissions") {
        return { submissions: [reviewedSubmission()], count: 1 };
      }
      throw new Error(`Unexpected read method: ${method}`);
    });

    render(<App />);
    await screen.findByText("Independent validators approved the submitted product evidence.");
    await user.click(screen.getByRole("button", { name: /^Dashboard$/i }));

    expect(await screen.findByText("Full GenLayer consensus report")).toBeInTheDocument();
    expect(screen.getByText("Finalized GenLayer state")).toBeInTheDocument();
    expect(screen.getByText(/Narrative and rationale fields are the leader report committed after validator agreement/i)).toBeInTheDocument();
    expect(screen.getByText("Independent validator agreement")).toBeInTheDocument();
    expect(screen.getByText("Independent full-artifact comparative validation")).toBeInTheDocument();
    expect(screen.getByText("Campaign task")).toBeInTheDocument();
    expect(screen.getByText("finalized_success=true")).toBeInTheDocument();
    expect(screen.getByText("Strong receipt, ownership, and outcome evidence.")).toBeInTheDocument();
    expect(screen.getByText("Stake is returned and the reserved campaign reward is unlocked.")).toBeInTheDocument();
    expect(screen.getByText("Evidence binding")).toBeInTheDocument();
    expect(screen.getByText("Exact facts returned by the Intelligent Contract")).toBeInTheDocument();
    expect(screen.getByText("Source contract")).toBeInTheDocument();
    expect(screen.getByText("Exact deal")).toBeInTheDocument();
    expect(screen.getByText("Exact recipient")).toBeInTheDocument();
    expect(screen.getByText("Exact amount (attoGEN)")).toBeInTheDocument();
    expect(screen.getByText("Settlement kind")).toBeInTheDocument();
    expect(screen.getByText("Released state")).toBeInTheDocument();
    expect(screen.getByText("Authenticated provenance")).toBeInTheDocument();
    expect(screen.getByText("Full-artifact coverage")).toBeInTheDocument();
    expect(screen.getByText("Every accepted obligation")).toBeInTheDocument();
    expect(screen.getByText("Reward reservation")).toBeInTheDocument();
    expect(screen.getByText("State committed by GenLayer consensus")).toBeInTheDocument();
  });

  it("never synthesizes analysis when finalized contract report fields are missing", async () => {
    const incomplete = {
      ...reviewedSubmission(),
      evidence_summary: undefined,
      improvement_recommendation: undefined,
      risk_flags: undefined,
      task_analysis: undefined,
      proof_reason: undefined,
      feedback_reason: undefined,
      insight_reason: undefined,
      originality_reason: undefined,
      consensus_checks: undefined,
      settlement_explanation: undefined
    };
    liveCampaigns = [campaign(1, "Checkout QA Campaign", 1)];
    readContract.mockImplementation(async (method: string) => {
      if (method === "list_campaigns") return { campaigns: liveCampaigns, count: 1, total: 1 };
      if (method === "list_campaign_submissions") return { submissions: [incomplete], count: 1 };
      throw new Error(`Unexpected read method: ${method}`);
    });

    render(<App />);
    await screen.findByText(incomplete.reason_summary);
    await userEvent.click(screen.getByRole("button", { name: /^Dashboard$/i }));

    expect(await screen.findByText("Incomplete on-chain report")).toBeInTheDocument();
    expect(screen.getByText(/VerdictProof does not synthesize missing analysis/i)).toBeInTheDocument();
    expect(screen.queryByText(/Detailed transaction analysis is unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Settlement follows the stored verdict/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Use a newer VerdictProof contract review/i)).not.toBeInTheDocument();
  });

  it("revalidates a cached local review hash with Bradbury RPC before showing consensus metadata", async () => {
    window.localStorage.setItem(
      "verdictproof:bradbury:0xfb7632b4bbe41d9fa986ae321e2bcaa1eea2478a:VERDICTPROOF_V2_5_FULL_ASSURANCE:tx-feed",
      JSON.stringify([{
        id: txHash,
        hash: txHash,
        label: "Run AI review",
        action: "review",
        submissionId: 1,
        campaignId: 1,
        createdAt: Date.now(),
        status: {
          stage: "finalized",
          statusName: "FINALIZED",
          resultName: "AGREE",
          executionResultName: "FINISHED_WITH_RETURN",
          validatorsAgreed: 5,
          validatorsTotal: 5,
          recipient: "0xfb7632B4BBe41D9fA986aE321e2BCAa1EeA2478a",
          functionName: "evaluate_submission"
        }
      }])
    );
    liveCampaigns = [campaign(1, "Checkout QA Campaign", 1)];
    readContract.mockImplementation(async (method: string) => {
      if (method === "list_campaigns") return { campaigns: liveCampaigns, count: 1, total: 1 };
      if (method === "list_campaign_submissions") return { submissions: [reviewedSubmission()], count: 1 };
      throw new Error(`Unexpected read method: ${method}`);
    });

    render(<App />);
    await screen.findByText(reviewedSubmission().reason_summary);
    await userEvent.click(screen.getByRole("button", { name: /^Dashboard$/i }));

    await waitFor(() => expect(getTransactionStatus).toHaveBeenCalledWith(txHash));
    expect(await screen.findByText("State committed by GenLayer consensus")).toBeInTheDocument();
    expect(screen.queryByText("Validator votes")).not.toBeInTheDocument();
  });

  it("renders a receipt-gate rejection from contract state", async () => {
    const hardGate = {
      ...reviewedSubmission(),
      status: "REJECTED",
      approved: false,
      score: 40,
      reward_amount: "0",
      task_completed: false,
      usage_valid: false,
      proof_score: 0,
      feedback_score: 18,
      insight_score: 13,
      originality_score: 9,
      validation_method: "INDEPENDENT_FULL_ARTIFACT_COMPARATIVE",
      receipt_checks: { ...reviewedSubmission().receipt_checks, sender_match: false, all_match: false },
      reason_summary: "Rejected because the finalized receipt sender does not match the tester wallet.",
      task_analysis: "Task completion was not evaluated because the finalized receipt failed a mandatory hard gate.",
      risk_flags: "IDENTITY_MISMATCH",
      consensus_checks: "FINALIZED_RECEIPT|EXACT_TRANSACTION_GATE|EXACT_IDENTITY_GATE|FEEDBACK_DELTA_5"
    };
    liveCampaigns = [campaign(1, "Checkout QA Campaign", 1)];
    readContract.mockImplementation(async (method: string) => {
      if (method === "list_campaigns") return { campaigns: liveCampaigns, count: 1, total: 1 };
      if (method === "list_campaign_submissions") return { submissions: [hardGate], count: 1 };
      throw new Error(`Unexpected read method: ${method}`);
    });

    render(<App />);
    await screen.findByText(hardGate.reason_summary);
    await userEvent.click(screen.getByRole("button", { name: /^Dashboard$/i }));

    expect(await screen.findByText("Independent full-artifact comparative validation")).toBeInTheDocument();
    expect(screen.getByText(hardGate.task_analysis)).toBeInTheDocument();
    expect(screen.getAllByText("false").length).toBeGreaterThan(0);
  });

  it("expires a timed-out submission and renders the contract refund lifecycle", async () => {
    const user = userEvent.setup();
    const pending = {
      ...reviewedSubmission(),
      status: "PENDING",
      approved: false,
      score: 0,
      reward_amount: "0",
      review_deadline: 1,
      reservation_status: "RESERVED",
      reason_summary: "Pending independent GenLayer review."
    };
    let liveSubmission = pending;
    liveCampaigns = [{ ...campaign(1, "Checkout QA Campaign", 1), reserved_reward_pool: "10000000000000000" }];
    readContract.mockImplementation(async (method: string) => {
      if (method === "list_campaigns") return { campaigns: liveCampaigns, count: 1, total: 1 };
      if (method === "list_campaign_submissions") return { submissions: [liveSubmission], count: 1 };
      throw new Error(`Unexpected read method: ${method}`);
    });
    waitAccepted.mockImplementation(async () => {
      liveSubmission = {
        ...pending,
        status: "EXPIRED",
        reservation_status: "RELEASED",
        settlement_explanation: "Review timeout expired; reservation returned and tester stake refunded.",
        settlement_record: { status: "SETTLED", kind: "EXPIRY_REFUND", recipient: walletAddress, amount_atto: "10000000000000000", released: true }
      };
    });

    render(<App />);
    await screen.findByText("Pending independent GenLayer review.");
    await user.click(screen.getAllByRole("button", { name: /Connect Wallet/i })[0]);
    await user.click(screen.getByRole("button", { name: /Expire & refund stake/i }));

    await waitFor(() => expect(writeContract).toHaveBeenCalledWith(expect.anything(), "expire_submission", [1n]));
    expect(await screen.findByText(/stake was refunded after the deterministic review timeout/i)).toBeInTheDocument();
  });

  it("lets an owner close a settled campaign and withdraw the remaining pool", async () => {
    const user = userEvent.setup();
    liveCampaigns = [campaign()];
    waitAccepted.mockImplementation(async () => {
      liveCampaigns = [{ ...campaign(), status: "CLOSED", reward_pool: "0" }];
    });

    render(<App />);
    expect(await screen.findAllByText("Checkout QA Campaign")).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: /Connect Wallet/i })[0]);
    await screen.findByText("0x9392...3259");
    await user.click(screen.getByRole("button", { name: /Close & withdraw remaining pool/i }));

    expect(screen.getByRole("heading", { name: /Close Campaign #1/i })).toBeInTheDocument();
    expect(screen.getByText("Refund to sponsor")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Close & withdraw 0.1 GEN/i }));

    await waitFor(() => {
      expect(writeContract).toHaveBeenCalledWith(
        expect.anything(),
        "close_campaign",
        [1n]
      );
    });
    expect(await screen.findByText("Campaign closed")).toBeInTheDocument();
  });
});
