import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Banknote,
  BrainCircuit,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  ExternalLink,
  Eye,
  FileSearch,
  Gauge,
  Layers3,
  Loader2,
  Network,
  Plus,
  Sparkles,
  Trophy,
  Wallet,
  X
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { formatGen, parseGen, scoreLabel, shortAddress } from "./format";
import type { Campaign, CampaignForm, ProofForm, Submission, SubmissionStatus } from "./types";
import {
  explorerContract,
  explorerTx,
  ensureBradburyNetwork,
  getTransactionStatus,
  type Eip1193Provider,
  hasContractConfig,
  makeWalletClient,
  readContract,
  type TxStatus,
  waitAccepted,
  writeContract
} from "./lib/genlayer";

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

type Eip6963ProviderDetail = {
  provider?: Eip1193Provider;
};

const defaultCampaignForm: CampaignForm = {
  title: "",
  productUrl: "",
  taskInstruction: "",
  proofRequirement: "",
  rewardPool: "0.1",
  rewardPerApproved: "0.01",
  stakeRequired: "0.01",
  minimumScore: "75"
};

const defaultProofForm: ProofForm = {
  transactionUrl: "",
  appResultUrl: "",
  feedbackText: ""
};

const ATTO_PER_GEN = 10n ** 18n;

type ChainCampaign = {
  campaign_id: number | string | bigint;
  owner: string;
  title: string;
  product_url: string;
  task_instruction: string;
  proof_requirement: string;
  reward_pool: string | number | bigint;
  reward_per_approved: string | number | bigint;
  stake_required: string | number | bigint;
  minimum_score: number | string | bigint;
  status: string;
  submission_count: number | string | bigint;
  approved_count: number | string | bigint;
  rejected_count: number | string | bigint;
};

type ChainSubmission = {
  submission_id: number | string | bigint;
  campaign_id: number | string | bigint;
  tester: string;
  transaction_url: string;
  app_result_url: string;
  feedback_text: string;
  stake_amount: string | number | bigint;
  status: string;
  score: number | string | bigint;
  approved: boolean;
  reward_amount: string | number | bigint;
  transaction_success?: boolean;
  identity_match?: boolean;
  task_completed?: boolean;
  usage_valid?: boolean;
  feedback_quality?: string;
  proof_score?: number | string | bigint;
  feedback_score?: number | string | bigint;
  insight_score?: number | string | bigint;
  originality_score?: number | string | bigint;
  reason_summary: string;
  evidence_summary?: string;
  improvement_recommendation?: string;
  risk_flags?: string;
  claimed: boolean;
};

function toNumber(value: number | string | bigint) {
  return Number(value);
}

function toBigInt(value: string | number | bigint) {
  return typeof value === "bigint" ? value : BigInt(value || 0);
}

function asCampaignStatus(value: string): Campaign["status"] {
  return value === "PAUSED" ? "PAUSED" : "OPEN";
}

function asSubmissionStatus(value: string): SubmissionStatus {
  if (value === "APPROVED" || value === "REJECTED" || value === "CLAIMED") return value;
  return "PENDING";
}

function normalizeCampaign(item: ChainCampaign): Campaign {
  return {
    campaignId: toNumber(item.campaign_id),
    owner: item.owner,
    title: item.title,
    productUrl: item.product_url,
    taskInstruction: item.task_instruction,
    proofRequirement: item.proof_requirement,
    rewardPool: toBigInt(item.reward_pool),
    rewardPerApproved: toBigInt(item.reward_per_approved),
    stakeRequired: toBigInt(item.stake_required),
    minimumScore: toNumber(item.minimum_score),
    status: asCampaignStatus(item.status),
    submissionCount: toNumber(item.submission_count),
    approvedCount: toNumber(item.approved_count),
    rejectedCount: toNumber(item.rejected_count)
  };
}

function normalizeSubmission(item: ChainSubmission, campaignTitle = "Live campaign"): Submission {
  return {
    submissionId: toNumber(item.submission_id),
    campaignId: toNumber(item.campaign_id),
    campaignTitle,
    tester: item.tester,
    transactionUrl: item.transaction_url,
    appResultUrl: item.app_result_url,
    feedbackText: item.feedback_text,
    stakeAmount: toBigInt(item.stake_amount),
    status: asSubmissionStatus(item.status),
    score: toNumber(item.score),
    approved: Boolean(item.approved),
    rewardAmount: toBigInt(item.reward_amount),
    transactionSuccess: Boolean(item.transaction_success),
    identityMatch: Boolean(item.identity_match),
    taskCompleted: Boolean(item.task_completed),
    usageValid: Boolean(item.usage_valid),
    feedbackQuality: item.feedback_quality || "UNASSESSED",
    proofScore: toNumber(item.proof_score ?? 0),
    feedbackScore: toNumber(item.feedback_score ?? 0),
    insightScore: toNumber(item.insight_score ?? 0),
    originalityScore: toNumber(item.originality_score ?? 0),
    reasonSummary: item.reason_summary,
    evidenceSummary: item.evidence_summary || "GenLayer review detail is not available for this submission.",
    improvementRecommendation: item.improvement_recommendation || "Use a newer VerdictProof contract review to receive a specific recommendation.",
    riskFlags: item.risk_flags || "UNSPECIFIED",
    claimed: Boolean(item.claimed)
  };
}

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error) {
    const details = collectErrorDetails(error);
    if (details) return details;
    if ("shortMessage" in error && typeof error.shortMessage === "string") return error.shortMessage;
    if ("details" in error && typeof error.details === "string") return error.details;
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

function collectErrorDetails(error: object) {
  const parts = new Set<string>();
  const visit = (value: unknown, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 3) return;
    const record = value as Record<string, unknown>;
    for (const key of ["shortMessage", "details", "message", "reason"] as const) {
      if (typeof record[key] === "string" && record[key].trim()) {
        parts.add(record[key].trim());
      }
    }
    if (typeof record.code === "number" || typeof record.code === "string") {
      parts.add(`code ${String(record.code)}`);
    }
    for (const key of ["data", "error", "cause"] as const) {
      if (key in record) visit(record[key], depth + 1);
    }
  };

  visit(error);
  return Array.from(parts).slice(0, 4).join(" | ");
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function discoverWalletProvider(): Promise<Eip1193Provider | null> {
  if (typeof window === "undefined") return null;
  if (window.ethereum) return window.ethereum;

  const providers: Eip1193Provider[] = [];
  const onProvider = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
    if (detail?.provider) {
      providers.push(detail.provider);
    }
  };

  window.addEventListener("eip6963:announceProvider", onProvider as EventListener);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await sleep(500);
  window.removeEventListener("eip6963:announceProvider", onProvider as EventListener);

  return window.ethereum ?? providers[0] ?? null;
}

type ActiveTx = {
  id: string;
  hash: string | null;
  label: string;
  status: TxStatus | null;
  error?: string;
  createdAt: number;
};

type LiveState = {
  campaigns: Campaign[];
  submissions: Submission[];
};

type AppView = "campaigns" | "review" | "dashboard" | "claims";

const CONTRACT_STORAGE_SCOPE = explorerContract().split("/").filter(Boolean).pop()?.toLowerCase() || "unconfigured";
const TX_FEED_STORAGE_KEY = `verdictproof:bradbury:${CONTRACT_STORAGE_SCOPE}:tx-feed:v2`;
const LIVE_STATE_STORAGE_KEY = `verdictproof:bradbury:${CONTRACT_STORAGE_SCOPE}:live-state:v2`;

function isAppView(value: string | null): value is AppView {
  return value === "campaigns" || value === "review" || value === "dashboard" || value === "claims";
}

function initialAppView(): AppView {
  if (typeof window === "undefined") return "campaigns";
  const view = new URLSearchParams(window.location.search).get("view");
  if (isAppView(view)) return view;
  return window.location.hash.startsWith("#submission-") ? "dashboard" : "campaigns";
}

function campaignIdFromUrl() {
  if (typeof window === "undefined") return 0;
  const value = Number(new URLSearchParams(window.location.search).get("campaign"));
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function preferredCampaignId(campaigns: Campaign[]) {
  return campaigns.reduce<Campaign | undefined>((preferred, campaign) => {
    if (!preferred || campaign.submissionCount > preferred.submissionCount) return campaign;
    if (campaign.submissionCount === preferred.submissionCount && campaign.campaignId < preferred.campaignId) {
      return campaign;
    }
    return preferred;
  }, undefined)?.campaignId ?? 0;
}

function submissionResultId(submission: Submission) {
  return `submission-${submission.campaignId}-${submission.submissionId}`;
}

function submissionResultHref(submission: Submission) {
  return `?view=dashboard&submission=${submission.campaignId}-${submission.submissionId}#${submissionResultId(submission)}`;
}

function compactUrlLabel(url: string) {
  try {
    const parsed = new URL(url, typeof window === "undefined" ? "https://verdictproof.vercel.app" : window.location.origin);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    const compactPath = path.length > 24 ? `${path.slice(0, 21)}...` : path;
    return `${parsed.hostname}${compactPath}`;
  } catch {
    return url.length > 28 ? `${url.slice(0, 25)}...` : url;
  }
}

function contractShortLabel() {
  const address = explorerContract().split("/").filter(Boolean).pop() ?? "Bradbury contract";
  return address.startsWith("0x") ? shortAddress(address) : address;
}

type StoredCampaign = Omit<Campaign, "rewardPool" | "rewardPerApproved" | "stakeRequired"> & {
  rewardPool: string;
  rewardPerApproved: string;
  stakeRequired: string;
};

type StoredSubmission = Omit<Submission, "stakeAmount" | "rewardAmount"> & {
  stakeAmount: string;
  rewardAmount: string;
};

type StoredLiveState = {
  campaigns: StoredCampaign[];
  submissions: StoredSubmission[];
  savedAt: number;
};

function storeLiveState(state: LiveState) {
  if (typeof window === "undefined") return;
  try {
    const stored: StoredLiveState = {
      campaigns: state.campaigns.map((campaign) => ({
        ...campaign,
        rewardPool: campaign.rewardPool.toString(),
        rewardPerApproved: campaign.rewardPerApproved.toString(),
        stakeRequired: campaign.stakeRequired.toString()
      })),
      submissions: state.submissions.map((submission) => ({
        ...submission,
        stakeAmount: submission.stakeAmount.toString(),
        rewardAmount: submission.rewardAmount.toString()
      })),
      savedAt: Date.now()
    };
    window.localStorage.setItem(LIVE_STATE_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Cache is only a startup accelerator; on-chain reads remain the source of truth.
  }
}

function loadStoredLiveState(): LiveState {
  if (typeof window === "undefined") return { campaigns: [], submissions: [] };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LIVE_STATE_STORAGE_KEY) ?? "null") as StoredLiveState | null;
    if (!parsed || !Array.isArray(parsed.campaigns) || !Array.isArray(parsed.submissions)) {
      return { campaigns: [], submissions: [] };
    }

    return {
      campaigns: parsed.campaigns.map((campaign) => ({
        ...campaign,
        rewardPool: BigInt(campaign.rewardPool || 0),
        rewardPerApproved: BigInt(campaign.rewardPerApproved || 0),
        stakeRequired: BigInt(campaign.stakeRequired || 0)
      })),
      submissions: parsed.submissions.map((submission) => ({
        ...submission,
        stakeAmount: BigInt(submission.stakeAmount || 0),
        rewardAmount: BigInt(submission.rewardAmount || 0),
        transactionSuccess: Boolean(submission.transactionSuccess),
        identityMatch: Boolean(submission.identityMatch),
        taskCompleted: Boolean(submission.taskCompleted),
        usageValid: Boolean(submission.usageValid),
        feedbackQuality: submission.feedbackQuality || "UNASSESSED",
        proofScore: Number(submission.proofScore || 0),
        feedbackScore: Number(submission.feedbackScore || 0),
        insightScore: Number(submission.insightScore || 0),
        originalityScore: Number(submission.originalityScore || 0)
      }))
    };
  } catch {
    return { campaigns: [], submissions: [] };
  }
}

function loadStoredTxFeed(): ActiveTx[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TX_FEED_STORAGE_KEY) ?? "[]") as ActiveTx[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => typeof item.id === "string" && typeof item.label === "string" && typeof item.createdAt === "number")
      .slice(0, 8);
  } catch {
    return [];
  }
}

function sameTxStatus(left: TxStatus | null, right: TxStatus | null) {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.stage === right.stage &&
    left.statusName === right.statusName &&
    left.resultName === right.resultName &&
    left.executionResultName === right.executionResultName &&
    left.validatorsAgreed === right.validatorsAgreed &&
    left.validatorsTotal === right.validatorsTotal
  );
}

function App() {
  const liveMode = hasContractConfig();
  const [initialLiveState] = useState<LiveState>(() => (liveMode ? loadStoredLiveState() : { campaigns: [], submissions: [] }));
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialLiveState.campaigns);
  const [submissions, setSubmissions] = useState<Submission[]>(initialLiveState.submissions);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number>(
    campaignIdFromUrl() || preferredCampaignId(initialLiveState.campaigns)
  );
  const [showCreate, setShowCreate] = useState(false);
  const [campaignForm, setCampaignForm] = useState<CampaignForm>(defaultCampaignForm);
  const [proofForm, setProofForm] = useState<ProofForm>(defaultProofForm);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);
  const [notice, setNotice] = useState(
    liveMode && initialLiveState.campaigns.length > 0
      ? `Showing ${initialLiveState.campaigns.length} cached Bradbury campaign${initialLiveState.campaigns.length === 1 ? "" : "s"}. Refreshing on-chain...`
      : liveMode
      ? "Live Bradbury contract configured. Loading on-chain campaigns..."
      : "Configure the Bradbury contract address to load the live VerdictProof protocol."
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [activeTx, setActiveTx] = useState<ActiveTx | null>(null);
  const [txFeed, setTxFeed] = useState<ActiveTx[]>(loadStoredTxFeed);
  const [activeView, setActiveView] = useState<AppView>(initialAppView);
  const [liveLoading, setLiveLoading] = useState(liveMode && initialLiveState.campaigns.length === 0);
  const [manualDisconnect, setManualDisconnect] = useState(false);

  const selectedCampaign = campaigns.find((campaign) => campaign.campaignId === selectedCampaignId) ?? campaigns[0];
  const selectedSubmissions = selectedCampaign ? submissions.filter((item) => item.campaignId === selectedCampaign.campaignId) : [];
  const mySubmissions = walletAddress
    ? submissions.filter((item) => item.tester.toLowerCase() === walletAddress.toLowerCase())
    : [];
  const totalPool = campaigns.reduce((sum, campaign) => sum + campaign.rewardPool, 0n);
  const totalPending = submissions.filter((item) => item.status === "PENDING").length;
  const isLiveReady = Boolean(liveMode && provider && walletAddress);
  const latestTx = activeTx ?? txFeed.find((item) => item.hash) ?? null;

  const stats = useMemo(
    () => [
      { label: "Reward pools", value: formatGen(totalPool), icon: CircleDollarSign },
      { label: "Campaigns", value: String(campaigns.length), icon: Layers3 },
      { label: "Pending reviews", value: String(totalPending), icon: Activity },
      { label: "My submissions", value: String(mySubmissions.length), icon: ClipboardCheck }
    ],
    [campaigns.length, mySubmissions.length, totalPending, totalPool]
  );

  const approvedSubmissions = submissions.filter((item) => item.status === "APPROVED" || item.status === "CLAIMED").length;
  const rejectedSubmissions = submissions.filter((item) => item.status === "REJECTED").length;
  const reviewedSubmissions = submissions.filter((item) => item.status === "APPROVED" || item.status === "REJECTED" || item.status === "CLAIMED");
  const pendingReviewSubmissions = submissions.filter((item) => item.status === "PENDING");

  useEffect(() => {
    const syncViewFromUrl = () => {
      const view = new URLSearchParams(window.location.search).get("view");
      if (isAppView(view)) {
        setActiveView(view);
        return;
      }
      if (window.location.hash.startsWith("#submission-")) {
        setActiveView("dashboard");
      }
    };

    window.addEventListener("hashchange", syncViewFromUrl);
    window.addEventListener("popstate", syncViewFromUrl);
    return () => {
      window.removeEventListener("hashchange", syncViewFromUrl);
      window.removeEventListener("popstate", syncViewFromUrl);
    };
  }, []);

  useEffect(() => {
    if (activeView !== "dashboard") return;
    const hash = window.location.hash;
    if (!hash.startsWith("#submission-")) return;
    const target = document.getElementById(hash.slice(1));
    if (!target) return;
    target.scrollIntoView({ block: "center" });
  }, [activeView, reviewedSubmissions.length]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TX_FEED_STORAGE_KEY, JSON.stringify(txFeed.slice(0, 8)));
  }, [txFeed]);

  const loadLiveData = useCallback(
    async (successMessage?: string): Promise<LiveState> => {
      if (!liveMode) return { campaigns: [], submissions: [] };
      setLiveLoading(true);
      try {
        const response = await readContract<{ campaigns: ChainCampaign[] }>("list_campaigns", [0n, 50n]);
        const liveCampaigns = (response.campaigns ?? []).map(normalizeCampaign);
        const liveCampaignIds = new Set(liveCampaigns.map((campaign) => campaign.campaignId));

        setCampaigns(liveCampaigns);
        setSubmissions((current) => current.filter((submission) => liveCampaignIds.has(submission.campaignId)));
        setSelectedCampaignId((current) =>
          liveCampaigns.some((campaign) => campaign.campaignId === campaignIdFromUrl())
            ? campaignIdFromUrl()
            : liveCampaigns.some((campaign) => campaign.campaignId === current)
              ? current
              : preferredCampaignId(liveCampaigns)
        );

        const liveSubmissions = (
          await Promise.all(
            liveCampaigns.map(async (campaign) => {
              const result = await readContract<{ submissions: ChainSubmission[] }>("list_campaign_submissions", [
                BigInt(campaign.campaignId)
              ]);
              return (result.submissions ?? []).map((submission) => normalizeSubmission(submission, campaign.title));
            })
          )
        ).flat();

        setSubmissions(liveSubmissions);
        storeLiveState({ campaigns: liveCampaigns, submissions: liveSubmissions });
        setNotice(successMessage ?? `Loaded ${liveCampaigns.length} live campaign${liveCampaigns.length === 1 ? "" : "s"} from Bradbury.`);
        return { campaigns: liveCampaigns, submissions: liveSubmissions };
      } finally {
        setLiveLoading(false);
      }
    },
    [liveMode]
  );

  useEffect(() => {
    if (!liveMode) return;
    loadLiveData().catch((error) => {
      setNotice(errorMessage(error, "Could not load live campaigns from GenLayer."));
    });
  }, [liveMode, loadLiveData]);

  useEffect(() => {
    if (!liveMode || manualDisconnect || provider || walletAddress) return;
    let cancelled = false;

    async function restoreAuthorizedWallet() {
      const walletProvider = await discoverWalletProvider();
      if (cancelled || !walletProvider) return;

      const accounts = (await walletProvider.request({ method: "eth_accounts" })) as string[];
      const address = accounts?.[0];
      if (cancelled || !address) return;

      setProvider(walletProvider);
      setWalletAddress(address);
      setNotice("Wallet session restored. Checking Bradbury network...");
      await ensureBradburyNetwork(walletProvider);
      if (!cancelled) {
        await loadLiveData("Wallet session restored. Live campaigns refreshed.");
      }
    }

    restoreAuthorizedWallet().catch(() => {
      if (!cancelled) {
        setNotice("Connect an injected wallet on Bradbury to create campaigns, stake GEN, and submit live proof.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [liveMode, loadLiveData, manualDisconnect, provider, walletAddress]);

  useEffect(() => {
    const hashes = txFeed
      .filter((item) => item.hash && item.status?.stage !== "failed" && item.status?.stage !== "finalized")
      .map((item) => item.hash as string);
    if (hashes.length === 0) return;
    let mounted = true;

    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      await Promise.all(
        hashes.map(async (hash) => {
          try {
            const status = await getTransactionStatus(hash);
            if (!mounted) return;
            setActiveTx((current) =>
              current?.hash === hash && !sameTxStatus(current.status, status) ? { ...current, status } : current
            );
            setTxFeed((items) => {
              let changed = false;
              const next = items.map((item) => {
                if (item.hash !== hash || sameTxStatus(item.status, status)) return item;
                changed = true;
                return { ...item, status };
              });
              return changed ? next : items;
            });
          } catch {
            // The explorer/RPC can lag just after wallet signing; the next poll usually resolves it.
          }
        })
      );
    };

    poll();
    const interval = window.setInterval(poll, 4500);
    const onVisibility = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mounted = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [txFeed]);

  useEffect(() => {
    if (!provider?.on) return;

    const onAccountsChanged = (accountsValue: unknown) => {
      const accounts = Array.isArray(accountsValue) ? accountsValue : [];
      const nextAddress = typeof accounts[0] === "string" ? accounts[0] : null;
      setWalletAddress(nextAddress);
      setProvider(nextAddress ? provider : null);
      setNotice(nextAddress ? `Wallet switched to ${shortAddress(nextAddress)}.` : "Wallet disconnected.");
      if (nextAddress && liveMode) {
        loadLiveData().catch((error) => setNotice(errorMessage(error, "Could not refresh after wallet switch.")));
      }
    };

    const onChainChanged = () => {
      setNotice("Wallet network changed. Checking Bradbury again...");
      ensureBradburyNetwork(provider)
        .then(() => (liveMode ? loadLiveData("Wallet is back on Bradbury. Live data refreshed.") : undefined))
        .catch((error) => setNotice(errorMessage(error, "Please switch your wallet to Bradbury chain 4221.")));
    };

    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);

    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [provider, liveMode, loadLiveData]);

  function requireLiveWallet(action: string) {
    if (!liveMode) {
      setNotice(`Configure a Bradbury contract address before you ${action}.`);
      return false;
    }
    if (isLiveReady) return true;
    setNotice(`Connect a wallet on Bradbury before you ${action}.`);
    return false;
  }

  async function waitForLiveState(predicate: (state: LiveState) => boolean, successMessage: string) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const state = await loadLiveData(attempt === 0 ? `${successMessage} Syncing contract state...` : undefined);
      if (predicate(state)) {
        setNotice(successMessage);
        return state;
      }
      await sleep(2500);
    }
    setNotice(`${successMessage} The transaction was accepted, but the indexed state has not appeared yet. Use Refresh on-chain.`);
    return { campaigns, submissions };
  }

  function trackSubmittedTx(hash: string, label: string) {
    const tx = { id: hash, hash, label, status: null, createdAt: Date.now() };
    setActiveTx(tx);
    setTxFeed((items) => [tx, ...items.filter((item) => item.hash !== hash)].slice(0, 8));
    return tx;
  }

  function markTxFailed(hash: string, error: string) {
    const failedStatus: TxStatus = {
      stage: "failed",
      statusName: "FAILED",
      resultName: "ERROR",
      executionResultName: "ERROR",
      validatorsAgreed: 0,
      validatorsTotal: 0
    };
    setActiveTx((current) => (current?.hash === hash ? { ...current, status: failedStatus, error } : current));
    setTxFeed((items) =>
      items.map((item) => (item.hash === hash ? { ...item, status: failedStatus, error } : item))
    );
  }

  function trackUnsubmittedFailure(label: string, error: string) {
    const failedStatus: TxStatus = {
      stage: "failed",
      statusName: "NO HASH",
      resultName: "NOT SUBMITTED",
      executionResultName: "NOT SUBMITTED",
      validatorsAgreed: 0,
      validatorsTotal: 0
    };
    const tx = {
      id: `${label}-${Date.now()}`,
      hash: null,
      label,
      status: failedStatus,
      error,
      createdAt: Date.now()
    };
    setTxFeed((items) => [tx, ...items].slice(0, 8));
  }

  async function runLiveWrite(
    label: string,
    walletMessage: string,
    write: (client: ReturnType<typeof makeWalletClient>) => Promise<unknown>,
    isSynced: (state: LiveState) => boolean,
    successMessage: (hash: string) => string
  ) {
    let hash = "";
    try {
      setNotice(walletMessage);
      await ensureBradburyNetwork(provider!);
      const client = makeWalletClient(provider!, walletAddress!);
      hash = String(await write(client));
      trackSubmittedTx(hash, label);
      setNotice(`${label} submitted. Use the transaction link in this flow to verify it.`);
      await waitAccepted(client, hash);
      await waitForLiveState(isSynced, successMessage(hash));
    } catch (error) {
      const message = errorMessage(error, `${label} failed.`);
      if (hash) {
        markTxFailed(hash, message);
        setNotice(`${label} failed after submission. Open its transaction link for details. ${message}`);
      } else {
        trackUnsubmittedFailure(label, message);
        setNotice(`${label} failed before a transaction hash was returned. ${message}`);
      }
      throw error;
    }
  }

  async function connectWallet() {
    const walletProvider = await discoverWalletProvider();
    if (!walletProvider) {
      setNotice("No wallet provider was detected. Open or unlock MetaMask, OKX, Rabby, or another EIP-1193 wallet, enable it for this site, then refresh and connect again.");
      return;
    }
    try {
      const accounts = (await walletProvider.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts?.[0]) {
        setManualDisconnect(false);
        setWalletAddress(accounts[0]);
        setProvider(walletProvider);
        setNotice("Wallet connected. Checking Bradbury network...");
        try {
          await ensureBradburyNetwork(walletProvider);
          setNotice(liveMode ? "Wallet ready on Bradbury. Live contract writes are enabled." : "Wallet connected. Configure a Bradbury contract address to write.");
        } catch (networkError) {
          setNotice(errorMessage(networkError, "Wallet connected, but Bradbury network switch failed. Please switch your wallet to Bradbury chain 4221."));
          return;
        }
        if (liveMode) {
          await loadLiveData("Wallet ready on Bradbury. Live campaigns refreshed.");
        }
      }
    } catch (error) {
      setNotice(errorMessage(error, "Wallet connection failed."));
    }
  }

  function disconnectWallet() {
    setManualDisconnect(true);
    setWalletAddress(null);
    setProvider(null);
    setNotice(liveMode ? "Wallet disconnected. Connect again to write to Bradbury." : "Wallet disconnected. Configure a Bradbury contract address to load protocol state.");
  }

  async function refreshOnchain() {
    if (!liveMode) {
      setNotice("Set the Bradbury contract address after deployment to read live campaigns.");
      return;
    }
    setBusy("refresh");
    try {
      await loadLiveData();
    } catch (error) {
      setNotice(errorMessage(error, "Could not read from GenLayer."));
    } finally {
      setBusy(null);
    }
  }

  async function createCampaign(event: FormEvent) {
    event.preventDefault();
    if (!requireLiveWallet("create a live campaign")) return;
    const nextId = Math.max(...campaigns.map((campaign) => campaign.campaignId), 0) + 1;
    const pool = parseGen(campaignForm.rewardPool);
    const reward = parseGen(campaignForm.rewardPerApproved);
    const stake = parseGen(campaignForm.stakeRequired);

    setBusy("create");
    try {
      await runLiveWrite(
        "Create campaign",
        "Open your wallet to approve funding this campaign on Bradbury...",
        (client) =>
          writeContract(
            client,
            "create_campaign",
            [
              campaignForm.title,
              campaignForm.productUrl,
              campaignForm.taskInstruction,
              campaignForm.proofRequirement,
              pool,
              reward,
              stake,
              BigInt(campaignForm.minimumScore)
            ],
            pool
          ),
        (state) => state.campaigns.some((campaign) => campaign.campaignId === nextId),
        (hash) => `Campaign accepted on Bradbury: ${hash}`
      );
      setSelectedCampaignId(nextId);
      setShowCreate(false);
    } catch (error) {
      setNotice(errorMessage(error, "Create campaign failed."));
    } finally {
      setBusy(null);
    }
  }

  async function submitProof(event: FormEvent) {
    event.preventDefault();
    if (!selectedCampaign) return;
    if (!requireLiveWallet("stake GEN and submit proof")) return;
    const nextId = Math.max(...submissions.map((submission) => submission.submissionId), 0) + 1;
    setBusy("submit");
    try {
      await runLiveWrite(
        "Stake and submit proof",
        "Open your wallet to approve the GEN stake for this proof...",
        (client) =>
          writeContract(
            client,
            "submit_proof",
            [
              BigInt(selectedCampaign.campaignId),
              selectedCampaign.stakeRequired,
              proofForm.transactionUrl,
              proofForm.appResultUrl,
              proofForm.feedbackText
            ],
            selectedCampaign.stakeRequired
          ),
        (state) => state.submissions.some((submission) => submission.submissionId === nextId),
        (hash) => `Proof submission accepted on Bradbury: ${hash}`
      );
    } catch (error) {
      setNotice(errorMessage(error, "Submit proof failed."));
    } finally {
      setBusy(null);
    }
  }

  async function reviewSubmission(submission: Submission) {
    if (!requireLiveWallet("run AI review")) return;
    setBusy(`review-${submission.submissionId}`);
    try {
      await runLiveWrite(
        "Run AI review",
        "Open your wallet to run GenLayer AI review for this submission...",
        (client) => writeContract(client, "evaluate_submission", [BigInt(submission.submissionId)]),
        (state) =>
          state.submissions.some(
            (item) => item.submissionId === submission.submissionId && item.status !== submission.status
          ),
        (hash) => `AI review accepted on Bradbury: ${hash}`
      );
    } catch (error) {
      setNotice(errorMessage(error, "AI review failed."));
    } finally {
      setBusy(null);
    }
  }

  async function claimReward(submission: Submission) {
    if (!requireLiveWallet("claim stake and reward")) return;
    setBusy(`claim-${submission.submissionId}`);
    try {
      await runLiveWrite(
        "Claim reward",
        "Open your wallet to claim stake and reward...",
        (client) => writeContract(client, "claim_reward", [BigInt(submission.submissionId)]),
        (state) =>
          state.submissions.some((item) => item.submissionId === submission.submissionId && item.status === "CLAIMED"),
        (hash) => `Claim accepted on Bradbury: ${hash}`
      );
    } catch (error) {
      setNotice(errorMessage(error, "Claim failed."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <img src="/assets/verdictproof-mark.svg" alt="" />
          </div>
          <div>
            <h1>VerdictProof</h1>
            <p>Evidence markets, settled by consensus.</p>
          </div>
        </div>
        <div className="topbar-actions">
          <nav className="primary-nav" aria-label="Primary navigation">
            <button className={`ghost-link ${activeView === "campaigns" ? "active" : ""}`} onClick={() => setActiveView("campaigns")}>
              Campaigns
            </button>
            <button className={`ghost-link ${activeView === "review" ? "active" : ""}`} onClick={() => setActiveView("review")}>
              Review
            </button>
            <button className={`ghost-link ${activeView === "dashboard" ? "active" : ""}`} onClick={() => setActiveView("dashboard")}>
              Dashboard
            </button>
            <button className={`ghost-link ${activeView === "claims" ? "active" : ""}`} onClick={() => setActiveView("claims")}>
              Claims
            </button>
          </nav>
          <a className="explorer-link" href={explorerContract()} target="_blank" rel="noreferrer">
            Explorer <ExternalLink size={13} />
          </a>
          {walletAddress ? (
            <div className="wallet-inline">
              <span className="wallet-address">
                <Wallet size={15} />
                {shortAddress(walletAddress)}
              </span>
              <button className="disconnect-button" onClick={disconnectWallet}>
                Disconnect
              </button>
            </div>
          ) : (
            <button className="wallet-button" onClick={connectWallet}>
              <Wallet size={16} />
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      <main>
        {activeView === "campaigns" ? (
          <>
        <section className="cinematic-hero">
          <img
            className="hero-art"
            src="/assets/verdict-prism.png"
            alt=""
            aria-hidden="true"
          />
          <div className="hero-scrim" aria-hidden="true" />
          <div className="hero-content">
            <div className="hero-eyebrow">
              <span className="live-dot" />
              Live on GenLayer Bradbury
            </div>
            <h2>Turn product evidence into an on-chain verdict.</h2>
            <p>
              Fund a testing brief. Testers stake GEN and submit public evidence. GenLayer validators inspect the
              proof, score its quality, and settle the reward.
            </p>
            <div className="hero-actions">
              <button className="primary-button" onClick={() => setShowCreate(true)}>
                <Plus size={16} />
                Create Campaign
              </button>
              <button className="secondary-button" onClick={() => setActiveView("dashboard")}>
                View verdicts
                <ArrowRight size={15} />
              </button>
            </div>
            <div className="hero-assurance">
              <span><CheckCircle2 size={14} /> Real GEN escrow</span>
              <span><FileSearch size={14} /> Public evidence</span>
              <span><BrainCircuit size={14} /> Validator consensus</span>
            </div>
          </div>
        </section>

        <section className="stats-grid protocol-stats">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div className="stat-card" key={stat.label}>
                <Icon size={18} />
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            );
          })}
        </section>

        <NoticeBar
          notice={notice}
          latestTx={latestTx}
          refreshing={busy === "refresh"}
          onRefresh={refreshOnchain}
          className="protocol-notice"
        />

        <div className="section-kicker" id="campaigns">
          <div>
            <span>Evidence market</span>
            <h3>Open campaigns</h3>
          </div>
          <p>Choose a live brief, complete the product task, and stake behind evidence you can defend.</p>
        </div>

        <div className="campaign-command-grid">
          <section className="panel campaign-board">
              <div className="panel-head">
                <div>
                  <h3>Campaigns</h3>
                  <p>Open product testing campaigns funded with small GEN pools.</p>
                </div>
                <button className="primary-button" onClick={() => setShowCreate(true)}>
                  <Plus size={16} />
                  Create Campaign
                </button>
              </div>
              <div className="campaign-list">
                {campaigns.length > 0 ? (
                  campaigns.map((campaign) => (
                    <CampaignCard
                      key={campaign.campaignId}
                      campaign={campaign}
                      selected={campaign.campaignId === selectedCampaign?.campaignId}
                      onOpen={() => setSelectedCampaignId(campaign.campaignId)}
                    />
                  ))
                ) : (
                  <div className="empty-state">
                    <Sparkles size={22} />
                    <strong>No live campaigns yet</strong>
                    <p>Create the first Bradbury campaign before testers can stake GEN and submit proof.</p>
                    <button className="primary-button" onClick={() => setShowCreate(true)}>
                      <Plus size={16} />
                      Create Live Campaign
                    </button>
                  </div>
                )}
              </div>
          </section>

          {selectedCampaign ? (
            <CampaignDetail
              campaign={selectedCampaign}
              submissions={selectedSubmissions}
              proofForm={proofForm}
              setProofForm={setProofForm}
              onSubmitProof={submitProof}
              onReview={reviewSubmission}
              busy={busy}
            />
          ) : null}
        </div>
          </>
        ) : null}

        {activeView === "review" ? (
          <section className="view-stage">
            <ViewHeader
              eyebrow="Review command"
              title="Judge pending product feedback."
              body={`${pendingReviewSubmissions.length} pending submission${pendingReviewSubmissions.length === 1 ? "" : "s"} awaiting GenLayer AI review.`}
            />
            <NoticeBar notice={notice} latestTx={latestTx} refreshing={busy === "refresh"} onRefresh={refreshOnchain} />
            <div className="review-view-grid">
              {selectedCampaign ? (
                <CampaignDetail
                  campaign={selectedCampaign}
                  submissions={selectedSubmissions}
                  proofForm={proofForm}
                  setProofForm={setProofForm}
                  onSubmitProof={submitProof}
                  onReview={reviewSubmission}
                  busy={busy}
                />
              ) : liveLoading ? (
                <div className="empty-state loading-state">
                  <Loader2 className="spin" size={22} />
                  <strong>Loading Bradbury campaigns</strong>
                  <p>Reading campaign state and review history from the VerdictProof contract.</p>
                </div>
              ) : (
                <div className="empty-state">
                  <Sparkles size={22} />
                  <strong>No campaign selected</strong>
                  <p>Create or open a campaign before running AI review.</p>
                </div>
              )}
            </div>
            <ReviewLifecycle />
          </section>
        ) : null}

        {activeView === "dashboard" ? (
          <section className="view-stage">
            <ViewHeader
              eyebrow="Dashboard"
              title="AI verdict history and protocol health."
              body="Every reviewed submission below is read from the Bradbury contract and includes the Intelligent Contract's evidence summary and recommendation."
            />
            <NoticeBar notice={notice} latestTx={latestTx} refreshing={busy === "refresh"} onRefresh={refreshOnchain} />
            <section className="stats-grid">
              {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div className="stat-card" key={stat.label}>
                    <Icon size={18} />
                    <span>{stat.label}</span>
                    <strong>{stat.value}</strong>
                  </div>
                );
              })}
            </section>
            <section className="signal-health">
              <div>
                <span>Approved signal</span>
                <strong>{approvedSubmissions}</strong>
              </div>
              <div>
                <span>Slashed noise</span>
                <strong>{rejectedSubmissions}</strong>
              </div>
              <div>
                <span>Contract mode</span>
                <strong>{liveMode ? "Bradbury live" : "Contract required"}</strong>
              </div>
            </section>
            <ReviewHistory submissions={reviewedSubmissions} />
          </section>
        ) : null}

        {activeView === "claims" ? (
          <section className="view-stage">
            <ViewHeader
              eyebrow="Claims"
              title="Rewards, stake returns, and slashes."
              body="Track your own submissions and claim approved stake plus reward when the contract unlocks payout."
            />
            <NoticeBar notice={notice} latestTx={latestTx} refreshing={busy === "refresh"} onRefresh={refreshOnchain} />
            <div className="claims-view-grid">
              <MySubmissions submissions={mySubmissions} onClaim={claimReward} busy={busy} />
            </div>
          </section>
        ) : null}
      </main>

      {showCreate ? (
        <CreateCampaignModal
          form={campaignForm}
          setForm={setCampaignForm}
          onSubmit={createCampaign}
          onClose={() => setShowCreate(false)}
          busy={busy === "create"}
        />
      ) : null}

    </div>
  );
}

function ViewHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="view-header">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function NoticeBar({
  notice,
  latestTx,
  refreshing,
  onRefresh,
  className = ""
}: {
  notice: string;
  latestTx: ActiveTx | null;
  refreshing: boolean;
  onRefresh: () => void;
  className?: string;
}) {
  return (
    <div className={`notice-row ${className}`.trim()} role="status" aria-live="polite">
      <p>{notice}</p>
      <div className="notice-actions">
        <TxInlineLinks tx={latestTx} />
        <button className="secondary-button" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="spin" size={15} /> : <Eye size={15} />}
          Refresh on-chain
        </button>
      </div>
    </div>
  );
}

function ReviewHistory({ submissions }: { submissions: Submission[] }) {
  const sorted = [...submissions].sort((a, b) => b.submissionId - a.submissionId).slice(0, 8);

  return (
    <section className="panel review-history">
      <div className="panel-head">
        <div>
          <h3>Reviewed Campaign Signals</h3>
          <p>Final AI verdicts written by the Intelligent Contract after reading proof links and tester feedback.</p>
        </div>
      </div>
      {sorted.length > 0 ? (
        <div className="history-list">
          {sorted.map((submission) => (
            <article className="history-card" id={submissionResultId(submission)} key={submission.submissionId}>
              <div className="history-top">
                <div>
                  <span className="panel-overline">Campaign #{submission.campaignId}</span>
                  <h4>{submission.campaignTitle}</h4>
                </div>
                <StatusBadge status={submission.status} />
              </div>
              <div className="history-score">
                <strong>{submission.score}/100</strong>
                <span>{scoreLabel(submission.score)}</span>
              </div>
              <p className="reason">{submission.reasonSummary}</p>
              <div className="verification-grid" aria-label="Verified on-chain evidence checks">
                <VerificationFact label="Transaction finalized" passed={submission.transactionSuccess} />
                <VerificationFact label="Tester wallet matched" passed={submission.identityMatch} />
                <VerificationFact label="Task completion proven" passed={submission.taskCompleted} />
              </div>
              <div className="rubric-grid" aria-label="GenLayer review score breakdown">
                <RubricScore label="Proof" value={submission.proofScore} maximum={40} />
                <RubricScore label="Specificity" value={submission.feedbackScore} maximum={25} />
                <RubricScore label="Insight" value={submission.insightScore} maximum={20} />
                <RubricScore label="Originality" value={submission.originalityScore} maximum={15} />
              </div>
              <div className="review-detail-grid">
                <div>
                  <span>Evidence checked</span>
                  <p>{submission.evidenceSummary}</p>
                </div>
                <div>
                  <span>Recommendation</span>
                  <p>{submission.improvementRecommendation}</p>
                </div>
              </div>
              <div className="history-links">
                <span>{submission.riskFlags}</span>
                <LinkChip
                  href={submission.transactionUrl}
                  label="Proof / tx note"
                  detail={compactUrlLabel(submission.transactionUrl)}
                  title="Open proof or transaction evidence"
                  external
                />
                <LinkChip
                  href={submissionResultHref(submission)}
                  label="AI result"
                  detail={`Dashboard #${submission.campaignId}-${submission.submissionId}`}
                  title="Open this AI review result in the dashboard"
                />
                <LinkChip
                  href={explorerContract()}
                  label="Contract"
                  detail={contractShortLabel()}
                  title="Open VerdictProof contract on Bradbury"
                  external
                />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="submissions-empty">
          <strong>No AI-reviewed campaigns yet</strong>
          <span>After GenLayer reviews a submission, its verdict and evidence analysis will appear here.</span>
        </div>
      )}
    </section>
  );
}

function VerificationFact({ label, passed }: { label: string; passed: boolean }) {
  return (
    <span className={passed ? "verification-fact passed" : "verification-fact failed"}>
      {passed ? <CheckCircle2 size={14} /> : <X size={14} />}
      {label}
    </span>
  );
}

function RubricScore({ label, value, maximum }: { label: string; value: number; maximum: number }) {
  return (
    <div className="rubric-score">
      <span>{label}</span>
      <strong>{value}/{maximum}</strong>
    </div>
  );
}

function CampaignCard({ campaign, selected, onOpen }: { campaign: Campaign; selected: boolean; onOpen: () => void }) {
  const poolPercent = Math.max(2, Math.min(100, Number((campaign.rewardPool * 100n) / ATTO_PER_GEN)));
  const reviewed = campaign.approvedCount + campaign.rejectedCount;
  const reviewPercent = campaign.submissionCount ? Math.round((reviewed / campaign.submissionCount) * 100) : 0;

  return (
    <article className={`campaign-card ${selected ? "selected" : ""}`}>
      <div className="card-topline">
        <StatusBadge status={campaign.status} />
        <span>{campaign.submissionCount} submissions</span>
      </div>
      <h4>{campaign.title}</h4>
      <a href={campaign.productUrl} target="_blank" rel="noreferrer">
        {campaign.productUrl}
      </a>
      <div className="metric-grid">
        <Metric label="Pool" value={formatGen(campaign.rewardPool)} />
        <Metric label="Reward" value={formatGen(campaign.rewardPerApproved)} />
        <Metric label="Stake" value={formatGen(campaign.stakeRequired)} />
        <Metric label="Min score" value={`${campaign.minimumScore}/100`} />
      </div>
      <div className="pool-rail" aria-label="Campaign reward pool progress">
        <div className="pool-fill" style={{ width: `${poolPercent}%` }} />
      </div>
      <div className="review-strip">
        <span>{campaign.approvedCount} approved</span>
        <span>{campaign.rejectedCount} slashed</span>
        <span>{reviewPercent}% reviewed</span>
      </div>
      <button className="open-button" onClick={onOpen}>
        Open Campaign <ArrowRight size={15} />
      </button>
    </article>
  );
}

function CampaignDetail({
  campaign,
  submissions,
  proofForm,
  setProofForm,
  onSubmitProof,
  onReview,
  busy
}: {
  campaign: Campaign;
  submissions: Submission[];
  proofForm: ProofForm;
  setProofForm: (form: ProofForm) => void;
  onSubmitProof: (event: FormEvent) => void;
  onReview: (submission: Submission) => void;
  busy: string | null;
}) {
  return (
    <section className="panel detail-panel" id="review">
      <div className="panel-head detail-head">
        <div>
          <span className="panel-overline">Review command center</span>
          <h3>{campaign.title}</h3>
          <span className="campaign-id-chip">Campaign #{campaign.campaignId}</span>
          <p className="campaign-brief">{campaign.taskInstruction}</p>
        </div>
        <StatusBadge status={campaign.status} />
      </div>

      <div className="command-center-grid">
        <div>
          <div className="detail-grid">
            <Metric label="Reward remaining" value={formatGen(campaign.rewardPool)} />
            <Metric label="Tester reward" value={formatGen(campaign.rewardPerApproved)} />
            <Metric label="Stake required" value={formatGen(campaign.stakeRequired)} />
            <Metric label="Minimum score" value={`${campaign.minimumScore}/100`} />
          </div>

          <details className="requirement-box">
            <summary>
              <Gauge size={18} />
              <span>Required proof</span>
            </summary>
            <p>{campaign.proofRequirement}</p>
          </details>
        </div>

        <form className="proof-form" onSubmit={onSubmitProof}>
          <h4>Stake GEN & Submit Proof</h4>
          <label>
            Transaction URL
            <input
              spellCheck={false}
              required
              placeholder="https://explorer-bradbury.genlayer.com/tx/..."
              value={proofForm.transactionUrl}
              onChange={(event) => setProofForm({ ...proofForm, transactionUrl: event.target.value })}
            />
          </label>
          <label>
            Outcome evidence URL
            <input
              spellCheck={false}
              required
              placeholder="https://public-result-or-contract.example/..."
              value={proofForm.appResultUrl}
              onChange={(event) => setProofForm({ ...proofForm, appResultUrl: event.target.value })}
            />
          </label>
          <label>
            Feedback text
            <textarea
              spellCheck={false}
              required
              placeholder="Describe what you tested, what happened, and one concrete product observation."
              value={proofForm.feedbackText}
              onChange={(event) => setProofForm({ ...proofForm, feedbackText: event.target.value })}
            />
          </label>
          <p className="form-hint">
            Validators verify transaction success, tester wallet ownership, task completion, and feedback quality.
          </p>
          <button className="primary-button full" type="submit" disabled={busy === "submit"}>
            {busy === "submit" ? <Loader2 className="spin" size={16} /> : <Banknote size={16} />}
            Stake {formatGen(campaign.stakeRequired)} & Submit Proof
          </button>
        </form>

      </div>

      <div className="submissions-block">
        <h4>Campaign submissions</h4>
        {submissions.length > 0 ? (
          submissions.map((submission) => (
            <SubmissionRow
              key={submission.submissionId}
              submission={submission}
              onReview={onReview}
              busy={busy === `review-${submission.submissionId}`}
            />
          ))
        ) : (
          <div className="submissions-empty">
            <strong>No submissions yet</strong>
            <span>After a tester stakes GEN and submits proof for this campaign, the AI review action will appear here.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function MySubmissions({
  submissions,
  onClaim,
  busy
}: {
  submissions: Submission[];
  onClaim: (submission: Submission) => void;
  busy: string | null;
}) {
  return (
    <section className="panel claim-console">
      <div className="panel-head">
        <div>
          <h3>My Submissions</h3>
          <p>Track pending reviews, rewards, stake returns, and slashed submissions.</p>
        </div>
      </div>
      <div className="my-grid">
        {submissions.map((submission) => (
          <article className="submission-card" key={submission.submissionId}>
            <div className="card-topline">
              <StatusBadge status={submission.status} />
              <span>{scoreLabel(submission.score)}</span>
            </div>
            <h4>{submission.campaignTitle}</h4>
            <div className="detail-grid compact">
              <Metric label="Stake" value={formatGen(submission.stakeAmount)} />
              <Metric label="Score" value={`${submission.score}/100`} />
              <Metric label="Reward" value={formatGen(submission.rewardAmount)} />
              <Metric
                label={submission.status === "REJECTED" ? "Slashed" : "Total claim"}
                value={
                  submission.status === "REJECTED"
                    ? formatGen(submission.stakeAmount)
                    : formatGen(submission.stakeAmount + submission.rewardAmount)
                }
              />
            </div>
            <p className="reason">{submission.reasonSummary}</p>
            <div className="mini-review-detail">
              <span>{submission.riskFlags}</span>
              <p>{submission.evidenceSummary}</p>
            </div>
            <SubmissionLinks submission={submission} />
            {submission.status === "APPROVED" ? (
              <button className="primary-button full" onClick={() => onClaim(submission)} disabled={busy === `claim-${submission.submissionId}`}>
                {busy === `claim-${submission.submissionId}` ? <Loader2 className="spin" size={16} /> : <BadgeCheck size={16} />}
                Claim stake + reward
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function TxInlineLinks({ tx }: { tx: ActiveTx | null }) {
  if (!tx?.hash) return null;
  const stage = tx.status?.stage ?? "pending";
  const label = stage === "accepted" || stage === "finalized" ? "Accepted" : stage === "failed" ? "Failed" : "Pending";

  return (
    <div className="tx-inline-links">
      <span className={`tx-inline-status tx-inline-status-${stage}`}>{label}</span>
      <a href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">
        View transaction
        <ExternalLink size={12} />
      </a>
      <a href={explorerContract()} target="_blank" rel="noreferrer">
        Contract
        <ExternalLink size={12} />
      </a>
    </div>
  );
}

function ReviewLifecycle() {
  const steps = [
    { title: "Read campaign brief", body: "Validators compare the task and proof requirements with submitted evidence.", icon: FileSearch },
    { title: "Read proof URL", body: "Transaction and result links are checked against the campaign task.", icon: Network },
    { title: "Analyze feedback", body: "Specificity, usefulness, and spam signals are scored.", icon: BrainCircuit },
    { title: "Consensus score", body: "GenLayer compares validator judgments around the approval threshold.", icon: Gauge },
    { title: "Reward or slash", body: "Approved testers claim; rejected stake returns to the pool.", icon: Trophy }
  ];

  return (
    <section className="lifecycle-section" id="lifecycle">
      <div className="section-kicker">
        <span>AI review lifecycle</span>
        <h3>How GenLayer scores signal.</h3>
      </div>
      <div className="lifecycle-grid">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <article className="lifecycle-card" key={step.title}>
              <div className="lifecycle-index">{index + 1}</div>
              <Icon size={20} />
              <h4>{step.title}</h4>
              <p>{step.body}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SubmissionRow({
  submission,
  onReview,
  busy
}: {
  submission: Submission;
  onReview: (submission: Submission) => void;
  busy: boolean;
}) {
  const stakeNote =
    submission.status === "PENDING"
      ? `Tester stake: ${formatGen(submission.stakeAmount)} locked in VerdictProof escrow until AI review finishes.`
      : submission.status === "APPROVED"
        ? `${formatGen(submission.stakeAmount)} stake is unlocked with ${formatGen(submission.rewardAmount)} reward available to claim.`
        : submission.status === "CLAIMED"
          ? `Stake and reward were claimed by ${shortAddress(submission.tester)}.`
          : `${formatGen(submission.stakeAmount)} stake was slashed back into the campaign pool.`;

  return (
    <article className="submission-row">
      <div>
        <div className="row-title">
          <strong>{shortAddress(submission.tester)}</strong>
          <StatusBadge status={submission.status} />
        </div>
        <p>{submission.reasonSummary}</p>
        <p className="stake-note">{stakeNote}</p>
        <SubmissionLinks submission={submission} />
      </div>
      <div className="row-score">
        <span>{submission.score}/100</span>
        <small>{formatGen(submission.rewardAmount)}</small>
      </div>
      {submission.status === "PENDING" ? (
        <button className="secondary-button" onClick={() => onReview(submission)} disabled={busy}>
          {busy ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
          Run AI Review
        </button>
      ) : null}
    </article>
  );
}

function LinkChip({
  href,
  label,
  detail,
  title,
  external = false
}: {
  href: string;
  label: string;
  detail?: string;
  title?: string;
  external?: boolean;
}) {
  return (
    <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} title={title}>
      <span className="chip-copy">
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      <ExternalLink size={12} />
    </a>
  );
}

function SubmissionLinks({ submission }: { submission: Submission }) {
  return (
    <div className="submission-links">
      <LinkChip
        href={submission.transactionUrl}
        label="Proof / tx note"
        detail={compactUrlLabel(submission.transactionUrl)}
        title="Open proof or transaction evidence"
        external
      />
      <LinkChip
        href={submissionResultHref(submission)}
        label="AI result"
        detail={`Dashboard #${submission.campaignId}-${submission.submissionId}`}
        title="Open the AI review result in the dashboard"
      />
      <LinkChip
        href={explorerContract()}
        label="Contract"
        detail={contractShortLabel()}
        title="Open VerdictProof contract on Bradbury"
        external
      />
    </div>
  );
}

function CreateCampaignModal({
  form,
  setForm,
  onSubmit,
  onClose,
  busy
}: {
  form: CampaignForm;
  setForm: (form: CampaignForm) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal" onSubmit={onSubmit}>
        <div className="modal-head">
          <div>
            <h3>Create Campaign</h3>
            <p>Fund a GEN pool and define what real product usage means.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close create campaign modal">
            <X size={18} />
          </button>
        </div>
        <label>
          Campaign title
          <input
            spellCheck={false}
            required
            placeholder="e.g. Audit the checkout flow for Acme Pay"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </label>
        <label>
          Product URL
          <input
            spellCheck={false}
            required
            placeholder="https://your-product.example"
            value={form.productUrl}
            onChange={(event) => setForm({ ...form, productUrl: event.target.value })}
          />
        </label>
        <label>
          Task instruction
          <textarea
            spellCheck={false}
            required
            placeholder="Tell testers exactly what real product flow to complete."
            value={form.taskInstruction}
            onChange={(event) => setForm({ ...form, taskInstruction: event.target.value })}
          />
        </label>
        <label>
          Required proof description
          <textarea
            spellCheck={false}
            required
            placeholder="Define which URLs and written observations prove the tester completed the task."
            value={form.proofRequirement}
            onChange={(event) => setForm({ ...form, proofRequirement: event.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            Reward pool
            <input spellCheck={false} required value={form.rewardPool} onChange={(event) => setForm({ ...form, rewardPool: event.target.value })} />
          </label>
          <label>
            Reward per tester
            <input spellCheck={false} required value={form.rewardPerApproved} onChange={(event) => setForm({ ...form, rewardPerApproved: event.target.value })} />
          </label>
          <label>
            Stake required
            <input spellCheck={false} required value={form.stakeRequired} onChange={(event) => setForm({ ...form, stakeRequired: event.target.value })} />
          </label>
          <label>
            Minimum score
            <input spellCheck={false} required value={form.minimumScore} onChange={(event) => setForm({ ...form, minimumScore: event.target.value })} />
          </label>
        </div>
        <button className="primary-button full" type="submit" disabled={busy}>
          {busy ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
          Create & Fund Campaign
        </button>
      </form>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ status }: { status: Campaign["status"] | SubmissionStatus }) {
  return <span className={`status status-${status.toLowerCase()}`}>{status}</span>;
}

export default App;
