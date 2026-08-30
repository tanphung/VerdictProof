import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Banknote,
  BrainCircuit,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
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
  isVerifiedReviewTransaction,
  isTransactionPendingError,
  makeWalletClient,
  readContract,
  REVIEW_TRANSACTIONS,
  RUBRIC_VERSION,
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
  minimumScore: "75",
  submissionDeadline: "",
  obligations: [
    { id: "OBL-001", text: "Complete the configured product task." },
    { id: "OBL-002", text: "Document the resulting product state." }
  ],
  githubOwner: "tanphung",
  githubRepository: "VerdictProof",
  artifactPath: "evidence/result.md",
  artifactContentType: "text/markdown",
  sourceContract: "",
  method: "",
  taskIdentifierSelector: "kwargs.task_identifier",
  taskIdentifierValue: "",
  dealSelector: "kwargs.deal_id",
  dealValue: "",
  recipientSelector: "kwargs.recipient",
  recipientValue: "",
  amountSelector: "kwargs.amount_atto",
  amountAtto: "",
  kindSelector: "kwargs.kind",
  kindValue: "RELEASE",
  releasedSelector: "kwargs.released",
  releasedValue: true
};

const defaultProofForm: ProofForm = {
  transactionUrl: "",
  commitSha: "",
  artifactSha256: "",
  artifactByteLength: "",
  feedbackText: ""
};

const ATTO_PER_GEN = 10n ** 18n;
const BRADBURY_TRANSACTION_URL = /^https:\/\/explorer-bradbury\.genlayer\.com\/tx\/0x[a-fA-F0-9]{64}(?:[?#].*)?$/;

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
  expired_count: number | string | bigint;
  reserved_reward_pool: string | number | bigint;
  available_reward_slots: number | string | bigint;
  revision: number | string | bigint;
  submission_deadline: number | string | bigint;
  review_timeout_seconds: number | string | bigint;
  obligations: Campaign["obligations"];
  artifact_policy: Campaign["artifactPolicy"];
  receipt_policy: Campaign["receiptPolicy"];
  repository_identity: Campaign["repositoryIdentity"];
  close_settlement: Campaign["closeSettlement"];
  rubric_version: string;
};

type ChainSubmission = {
  submission_id: number | string | bigint;
  campaign_id: number | string | bigint;
  campaign_revision: number | string | bigint;
  tester: string;
  transaction_url: string;
  feedback_text: string;
  stake_amount: string | number | bigint;
  status: string;
  score: number | string | bigint;
  approved: boolean;
  reward_amount: string | number | bigint;
  submitted_at: number | string | bigint;
  review_deadline: number | string | bigint;
  commit_sha: string;
  artifact_key: string;
  provenance_manifest: Submission["provenanceManifest"];
  artifact_sha256: string;
  artifact_byte_length: number | string | bigint;
  total_chunks: number | string | bigint;
  chunk_digests: string[];
  receipt_checks: Submission["receiptChecks"];
  obligation_assessments: Submission["obligationAssessments"];
  reviewed_chunks: number[];
  task_completed?: boolean;
  usage_valid?: boolean;
  proof_score?: number | string | bigint;
  feedback_score?: number | string | bigint;
  insight_score?: number | string | bigint;
  originality_score?: number | string | bigint;
  reason_summary: string;
  evidence_summary?: string;
  improvement_recommendation?: string;
  risk_flags?: string;
  rubric_version?: string;
  validation_method?: string;
  task_analysis?: string;
  proof_reason?: string;
  feedback_reason?: string;
  insight_reason?: string;
  originality_reason?: string;
  consensus_checks?: string;
  settlement_explanation?: string;
  evidence_transaction_hash?: string;
  reserved_reward_amount?: string | number | bigint;
  reservation_status?: string;
  settlement_record: Submission["settlementRecord"];
  claimed: boolean;
};

type ChainEvidenceUsage = {
  transaction_hash: string;
  artifact_key: string;
  transaction_submission_id: number | string | bigint;
  artifact_submission_id: number | string | bigint;
  available: boolean;
};

function toNumber(value: number | string | bigint) {
  return Number(value);
}

function toBigInt(value: string | number | bigint) {
  return typeof value === "bigint" ? value : BigInt(value || 0);
}

function asCampaignStatus(value: string): Campaign["status"] {
  if (value === "CLOSED") return "CLOSED";
  return value === "PAUSED" ? "PAUSED" : "OPEN";
}

function asSubmissionStatus(value: string): SubmissionStatus {
  if (value === "APPROVED" || value === "REJECTED" || value === "CLAIMED" || value === "EXPIRED") return value;
  return "PENDING";
}

function validationMethodLabel(method: string) {
  if (method === "INDEPENDENT_FULL_ARTIFACT_COMPARATIVE") {
    return "Independent full-artifact comparative validation";
  }
  if (method === "INDEPENDENT_HARD_GATE_FEEDBACK") {
    return "Independent hard-gate + comparative feedback";
  }
  if (method === "INDEPENDENT_COMPARATIVE") {
    return "Independent comparative semantic validation";
  }
  return method.split("_").join(" ");
}

const ONCHAIN_REPORT_FIELDS: Array<[keyof Submission, string]> = [
  ["reasonSummary", "reason_summary"],
  ["evidenceSummary", "evidence_summary"],
  ["improvementRecommendation", "improvement_recommendation"],
  ["riskFlags", "risk_flags"],
  ["rubricVersion", "rubric_version"],
  ["validationMethod", "validation_method"],
  ["taskAnalysis", "task_analysis"],
  ["proofReason", "proof_reason"],
  ["feedbackReason", "feedback_reason"],
  ["insightReason", "insight_reason"],
  ["originalityReason", "originality_reason"],
  ["consensusChecks", "consensus_checks"],
  ["settlementExplanation", "settlement_explanation"],
  ["evidenceTransactionHash", "evidence_transaction_hash"],
  ["artifactKey", "artifact_key"],
  ["artifactSha256", "artifact_sha256"],
  ["reservationStatus", "reservation_status"]
];

function missingOnchainReportFields(submission: Submission) {
  const missing = ONCHAIN_REPORT_FIELDS.filter(([field]) => !String(submission[field] ?? "").trim()).map(([, label]) => label);
  if (Object.keys(submission.provenanceManifest).length === 0) missing.push("provenance_manifest");
  if (submission.artifactByteLength <= 0) missing.push("artifact_byte_length");
  if (submission.totalChunks <= 0) missing.push("total_chunks");
  if (submission.chunkDigests.length !== submission.totalChunks) missing.push("chunk_digests");
  if (Object.keys(submission.receiptChecks).length === 0) missing.push("receipt_checks");
  if (submission.obligationAssessments.length === 0) missing.push("obligation_assessments");
  if (
    submission.reviewedChunks.length !== submission.totalChunks ||
    submission.reviewedChunks.some((chunk, index) => chunk !== index)
  ) missing.push("reviewed_chunks");
  if (Object.keys(submission.settlementRecord).length === 0) missing.push("settlement_record");
  return missing;
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
    rejectedCount: toNumber(item.rejected_count),
    expiredCount: toNumber(item.expired_count),
    reservedRewardPool: toBigInt(item.reserved_reward_pool),
    availableRewardSlots: toNumber(item.available_reward_slots),
    revision: toNumber(item.revision),
    submissionDeadline: toNumber(item.submission_deadline),
    reviewTimeoutSeconds: toNumber(item.review_timeout_seconds),
    obligations: item.obligations,
    artifactPolicy: item.artifact_policy,
    receiptPolicy: item.receipt_policy,
    repositoryIdentity: item.repository_identity,
    closeSettlement: item.close_settlement,
    rubricVersion: item.rubric_version,
    expectedSourceContract: item.receipt_policy.source_contract,
    expectedMethod: item.receipt_policy.method,
    expectedTaskIdentifier: String(item.receipt_policy.task_identifier.value)
  };
}

function normalizeSubmission(item: ChainSubmission, campaign?: Campaign): Submission {
  return {
    submissionId: toNumber(item.submission_id),
    campaignId: toNumber(item.campaign_id),
    campaignRevision: toNumber(item.campaign_revision),
    campaignTitle: campaign?.title ?? "Live campaign",
    tester: item.tester,
    transactionUrl: item.transaction_url,
    feedbackText: item.feedback_text,
    stakeAmount: toBigInt(item.stake_amount),
    status: asSubmissionStatus(item.status),
    score: toNumber(item.score),
    approved: Boolean(item.approved),
    rewardAmount: toBigInt(item.reward_amount),
    submittedAt: toNumber(item.submitted_at),
    reviewDeadline: toNumber(item.review_deadline),
    commitSha: item.commit_sha,
    artifactKey: item.artifact_key,
    artifactUrl: campaign
      ? `https://github.com/${campaign.artifactPolicy.owner}/${campaign.artifactPolicy.repository}/blob/${item.commit_sha}/${campaign.artifactPolicy.path}`
      : "",
    provenanceManifest: item.provenance_manifest,
    artifactSha256: item.artifact_sha256,
    artifactByteLength: toNumber(item.artifact_byte_length),
    totalChunks: toNumber(item.total_chunks),
    chunkDigests: item.chunk_digests,
    receiptChecks: item.receipt_checks,
    obligationAssessments: item.obligation_assessments,
    reviewedChunks: item.reviewed_chunks,
    transactionSuccess: Boolean(item.receipt_checks?.finalized_success),
    identityMatch: Boolean(item.receipt_checks?.sender_match),
    taskCompleted: Boolean(item.task_completed),
    usageValid: Boolean(item.usage_valid),
    proofScore: toNumber(item.proof_score ?? 0),
    feedbackScore: toNumber(item.feedback_score ?? 0),
    insightScore: toNumber(item.insight_score ?? 0),
    originalityScore: toNumber(item.originality_score ?? 0),
    reasonSummary: item.reason_summary,
    evidenceSummary: item.evidence_summary ?? "",
    improvementRecommendation: item.improvement_recommendation ?? "",
    riskFlags: item.risk_flags ?? "",
    rubricVersion: item.rubric_version ?? "",
    validationMethod: item.validation_method ?? "",
    taskAnalysis: item.task_analysis ?? "",
    proofReason: item.proof_reason ?? "",
    feedbackReason: item.feedback_reason ?? "",
    insightReason: item.insight_reason ?? "",
    originalityReason: item.originality_reason ?? "",
    consensusChecks: item.consensus_checks ?? "",
    settlementExplanation: item.settlement_explanation ?? "",
    settlementRecord: item.settlement_record ?? {},
    evidenceTransactionHash: item.evidence_transaction_hash ?? "",
    reservedRewardAmount: toBigInt(item.reserved_reward_amount ?? 0),
    reservationStatus: (
      item.reservation_status === "CONSUMED" || item.reservation_status === "RELEASED"
        ? item.reservation_status
        : "RESERVED"
    ),
    sourceContractMatch: Boolean(item.receipt_checks?.source_contract_match),
    methodMatch: Boolean(item.receipt_checks?.method_match),
    taskIdentifierMatch: Boolean(item.receipt_checks?.task_identifier_match),
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
  action?: "create" | "submit" | "review" | "expire" | "claim" | "close";
  submissionId?: number;
  campaignId?: number;
};

type ReviewConsensus = {
  hash: string;
  status: TxStatus;
};

type LiveState = {
  campaigns: Campaign[];
  submissions: Submission[];
};

type AppView = "campaigns" | "review" | "dashboard" | "claims";

const CONTRACT_STORAGE_SCOPE = explorerContract().split("/").filter(Boolean).pop()?.toLowerCase() || "unconfigured";
const TX_FEED_STORAGE_KEY = `verdictproof:bradbury:${CONTRACT_STORAGE_SCOPE}:${RUBRIC_VERSION}:tx-feed`;
const LIVE_STATE_STORAGE_KEY = `verdictproof:bradbury:${CONTRACT_STORAGE_SCOPE}:${RUBRIC_VERSION}:live-state`;

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

function isBradburyTransactionUrl(url: string) {
  return BRADBURY_TRANSACTION_URL.test(url.trim());
}

function contractShortLabel() {
  const address = explorerContract().split("/").filter(Boolean).pop() ?? "Bradbury contract";
  return address.startsWith("0x") ? shortAddress(address) : address;
}

type StoredCampaign = Omit<Campaign, "rewardPool" | "rewardPerApproved" | "stakeRequired" | "reservedRewardPool"> & {
  rewardPool: string;
  rewardPerApproved: string;
  stakeRequired: string;
  reservedRewardPool: string;
};

type StoredSubmission = Omit<Submission, "stakeAmount" | "rewardAmount" | "reservedRewardAmount"> & {
  stakeAmount: string;
  rewardAmount: string;
  reservedRewardAmount: string;
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
        stakeRequired: campaign.stakeRequired.toString(),
        reservedRewardPool: campaign.reservedRewardPool.toString()
      })),
      submissions: state.submissions.map((submission) => ({
        ...submission,
        stakeAmount: submission.stakeAmount.toString(),
        rewardAmount: submission.rewardAmount.toString(),
        reservedRewardAmount: submission.reservedRewardAmount.toString()
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
        stakeRequired: BigInt(campaign.stakeRequired || 0),
        reservedRewardPool: BigInt(campaign.reservedRewardPool || 0)
      })),
      submissions: parsed.submissions.map((submission) => ({
        ...submission,
        stakeAmount: BigInt(submission.stakeAmount || 0),
        rewardAmount: BigInt(submission.rewardAmount || 0),
        reservedRewardAmount: BigInt(submission.reservedRewardAmount || 0),
        transactionSuccess: Boolean(submission.transactionSuccess),
        identityMatch: Boolean(submission.identityMatch),
        taskCompleted: Boolean(submission.taskCompleted),
        usageValid: Boolean(submission.usageValid),
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
  const [closingCampaign, setClosingCampaign] = useState<Campaign | null>(null);
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
  const [reviewConsensus, setReviewConsensus] = useState<Record<number, ReviewConsensus>>({});

  const selectedCampaign = campaigns.find((campaign) => campaign.campaignId === selectedCampaignId) ?? campaigns[0];
  const selectedSubmissions = selectedCampaign ? submissions.filter((item) => item.campaignId === selectedCampaign.campaignId) : [];
  const mySubmissions = walletAddress
    ? submissions.filter((item) => item.tester.toLowerCase() === walletAddress.toLowerCase())
    : [];
  const totalAvailablePool = campaigns.reduce((sum, campaign) => sum + campaign.rewardPool, 0n);
  const totalReservedPool = campaigns.reduce((sum, campaign) => sum + campaign.reservedRewardPool, 0n);
  const totalPool = totalAvailablePool + totalReservedPool;
  const totalPending = submissions.filter((item) => item.status === "PENDING").length;
  const isLiveReady = Boolean(liveMode && provider && walletAddress);
  const latestTx = activeTx ?? txFeed.find((item) => item.hash) ?? null;

  const stats = useMemo(
    () => [
      { label: "Reward pools", value: formatGen(totalPool), icon: CircleDollarSign },
      { label: "Available", value: formatGen(totalAvailablePool), icon: Banknote },
      { label: "Reserved", value: formatGen(totalReservedPool), icon: BadgeCheck },
      { label: "Campaigns", value: String(campaigns.length), icon: Layers3 },
      { label: "Pending reviews", value: String(totalPending), icon: Activity },
      { label: "My submissions", value: String(mySubmissions.length), icon: ClipboardCheck }
    ],
    [campaigns.length, mySubmissions.length, totalAvailablePool, totalPending, totalPool, totalReservedPool]
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

  useEffect(() => {
    if (reviewedSubmissions.length === 0) return;
    let mounted = true;

    const verify = async () => {
      const entries = await Promise.all(
        reviewedSubmissions.map(async (submission) => {
          const local = txFeed.find(
            (item) => item.action === "review" && item.submissionId === submission.submissionId && item.hash
          );
          const configured = REVIEW_TRANSACTIONS[`${submission.campaignId}-${submission.submissionId}`];
          const hash = local?.hash ?? configured;
          if (!hash) return null;
          try {
            const status = await getTransactionStatus(hash);
            return isVerifiedReviewTransaction(status)
              ? ([submission.submissionId, { hash, status }] as const)
              : null;
          } catch {
            return null;
          }
        })
      );
      if (!mounted) return;
      setReviewConsensus(
        Object.fromEntries(entries.filter((entry): entry is readonly [number, ReviewConsensus] => Boolean(entry)))
      );
    };

    verify();
    return () => {
      mounted = false;
    };
  }, [submissions, txFeed]);

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
              return (result.submissions ?? []).map((submission) => normalizeSubmission(submission, campaign));
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
      const detail = errorMessage(error, "Could not load live campaigns from GenLayer.");
      setNotice(
        initialLiveState.campaigns.length > 0
          ? `${detail} Cached data remains visible and may be stale; no current Bradbury state was confirmed.`
          : detail
      );
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
      .filter((item) => item.hash && (!item.status || item.status.stage === "pending"))
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
            const tracked = txFeed.find((item) => item.hash === hash);
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
            if (status.stage === "accepted" || status.stage === "finalized") {
              await loadLiveData(`${tracked?.label || "Transaction"} confirmed on Bradbury. Live state refreshed.`);
            } else if (status.stage === "failed") {
              setNotice(`${tracked?.label || "Transaction"} failed on Bradbury. Open its transaction link for details.`);
            }
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
  }, [loadLiveData, txFeed]);

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

  function trackSubmittedTx(
    hash: string,
    label: string,
    metadata: Pick<ActiveTx, "action" | "submissionId" | "campaignId"> = {}
  ) {
    const tx = { id: hash, hash, label, status: null, createdAt: Date.now(), ...metadata };
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
    successMessage: (hash: string) => string,
    metadata: Pick<ActiveTx, "action" | "submissionId" | "campaignId"> = {}
  ) {
    let hash = "";
    try {
      setNotice(walletMessage);
      await ensureBradburyNetwork(provider!);
      const client = makeWalletClient(provider!, walletAddress!);
      hash = String(await write(client));
      trackSubmittedTx(hash, label, metadata);
      setNotice(`${label} submitted. Use the transaction link in this flow to verify it.`);
      await waitAccepted(hash);
      await waitForLiveState(isSynced, successMessage(hash));
    } catch (error) {
      if (hash && isTransactionPendingError(error)) {
        setNotice(`${label} is still in GenLayer consensus. You can continue using VerdictProof; this transaction will update automatically when Bradbury settles it.`);
        return;
      }
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
      } else {
        setNotice("The wallet did not return an account. Unlock it, approve account access for VerdictProof, then connect again.");
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
      const detail = errorMessage(error, "Could not read from GenLayer.");
      setNotice(
        campaigns.length > 0
          ? `${detail} Cached data remains visible and may be stale; no current Bradbury state was confirmed.`
          : detail
      );
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
    const submissionDeadline = campaignForm.submissionDeadline
      ? Math.floor(new Date(campaignForm.submissionDeadline).getTime() / 1000)
      : Math.floor(Date.now() / 1000) + 7 * 86400;
    const policy = {
      schema: "VERDICTPROOF_POLICY_V1",
      submission_deadline: submissionDeadline,
      obligations: campaignForm.obligations.filter((item) => item.id.trim() && item.text.trim()),
      artifact: {
        provider: "GITHUB",
        auth_mode: "GITHUB_API",
        owner: campaignForm.githubOwner,
        repository: campaignForm.githubRepository,
        path: campaignForm.artifactPath,
        content_type: campaignForm.artifactContentType
      },
      receipt: {
        source_contract: campaignForm.sourceContract,
        method: campaignForm.method,
        task_identifier: { selector: campaignForm.taskIdentifierSelector, value: campaignForm.taskIdentifierValue },
        deal: { selector: campaignForm.dealSelector, value: campaignForm.dealValue },
        recipient: { selector: campaignForm.recipientSelector, value: campaignForm.recipientValue },
        amount_atto: { selector: campaignForm.amountSelector, value: campaignForm.amountAtto },
        kind: { selector: campaignForm.kindSelector, value: campaignForm.kindValue },
        released: { selector: campaignForm.releasedSelector, value: campaignForm.releasedValue }
      }
    };

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
              BigInt(campaignForm.minimumScore),
              JSON.stringify(policy)
            ],
            pool
          ),
        (state) => state.campaigns.some((campaign) => campaign.campaignId === nextId),
        (hash) => `Campaign accepted on Bradbury: ${hash}`,
        { action: "create", campaignId: nextId }
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
    if (!isBradburyTransactionUrl(proofForm.transactionUrl)) {
      setNotice("Use a complete Bradbury explorer transaction URL so validators can verify execution and wallet ownership.");
      return;
    }
    if (!requireLiveWallet("stake GEN and submit proof")) return;
    const nextId = Math.max(...submissions.map((submission) => submission.submissionId), 0) + 1;
    setBusy("submit");
    try {
      if (selectedCampaign.availableRewardSlots < 1) {
        throw new Error("This campaign has no unreserved reward capacity for another submission.");
      }
      const usage = await readContract<ChainEvidenceUsage>("get_evidence_usage", [
        BigInt(selectedCampaign.campaignId),
        proofForm.transactionUrl,
        proofForm.commitSha
      ]);
      if (!usage.available) {
        const consumedBy = toNumber(usage.transaction_submission_id || usage.artifact_submission_id || 0);
        throw new Error(
          consumedBy > 0
            ? `This evidence reference was already consumed by Submission #${consumedBy}.`
            : "The evidence URLs are not valid stable references."
        );
      }
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
              proofForm.commitSha,
              proofForm.artifactSha256,
              BigInt(proofForm.artifactByteLength),
              proofForm.feedbackText
            ],
            selectedCampaign.stakeRequired
          ),
        (state) => state.submissions.some((submission) => submission.submissionId === nextId),
        (hash) => `Proof submission accepted on Bradbury: ${hash}`,
        { action: "submit", submissionId: nextId, campaignId: selectedCampaign.campaignId }
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
        (hash) => `AI review accepted on Bradbury: ${hash}`,
        { action: "review", submissionId: submission.submissionId, campaignId: submission.campaignId }
      );
    } catch (error) {
      setNotice(errorMessage(error, "AI review failed."));
    } finally {
      setBusy(null);
    }
  }

  async function expireSubmission(submission: Submission) {
    if (!requireLiveWallet("expire this timed-out submission")) return;
    setBusy(`expire-${submission.submissionId}`);
    try {
      await runLiveWrite(
        "Expire submission",
        "Open your wallet to release the reserved reward and refund the tester stake...",
        (client) => writeContract(client, "expire_submission", [BigInt(submission.submissionId)]),
        (state) =>
          state.submissions.some(
            (item) => item.submissionId === submission.submissionId && item.status === "EXPIRED"
          ),
        (hash) => `Expiry refund accepted on Bradbury: ${hash}`,
        { action: "expire", submissionId: submission.submissionId, campaignId: submission.campaignId }
      );
    } catch (error) {
      setNotice(errorMessage(error, "Expire submission failed."));
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
        (hash) => `Claim accepted on Bradbury: ${hash}`,
        { action: "claim", submissionId: submission.submissionId, campaignId: submission.campaignId }
      );
    } catch (error) {
      setNotice(errorMessage(error, "Claim failed."));
    } finally {
      setBusy(null);
    }
  }

  async function closeCampaign(campaign: Campaign) {
    if (!requireLiveWallet("close this campaign and withdraw its remaining pool")) return;
    setBusy(`close-${campaign.campaignId}`);
    try {
      await runLiveWrite(
        "Close campaign",
        `Open your wallet to close Campaign #${campaign.campaignId} and withdraw ${formatGen(campaign.rewardPool)}...`,
        (client) => writeContract(client, "close_campaign", [BigInt(campaign.campaignId)]),
        (state) =>
          state.campaigns.some(
            (item) => item.campaignId === campaign.campaignId && item.status === "CLOSED" && item.rewardPool === 0n
          ),
        (hash) => `Campaign closed and remaining pool returned on Bradbury: ${hash}`,
        { action: "close", campaignId: campaign.campaignId }
      );
      setClosingCampaign(null);
    } catch (error) {
      setNotice(errorMessage(error, "Close campaign failed."));
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
              onExpire={expireSubmission}
              walletAddress={walletAddress}
              onRequestClose={setClosingCampaign}
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
                  onExpire={expireSubmission}
                  walletAddress={walletAddress}
                  onRequestClose={setClosingCampaign}
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
            <ReviewHistory
              submissions={reviewedSubmissions}
              campaigns={campaigns}
              consensus={reviewConsensus}
            />
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

      {closingCampaign ? (
        <CloseCampaignModal
          campaign={closingCampaign}
          onConfirm={() => closeCampaign(closingCampaign)}
          onClose={() => setClosingCampaign(null)}
          busy={busy === `close-${closingCampaign.campaignId}`}
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

function ReviewHistory({
  submissions,
  campaigns,
  consensus
}: {
  submissions: Submission[];
  campaigns: Campaign[];
  consensus: Record<number, ReviewConsensus>;
}) {
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
          {sorted.map((submission, index) => {
            const campaign = campaigns.find((item) => item.campaignId === submission.campaignId);
            const reviewTx = consensus[submission.submissionId];
            const missingReportFields = missingOnchainReportFields(submission);
            const reportIdentity = [submission.validationMethod, submission.rubricVersion].filter(Boolean).join(" · ");
            const openFromUrl =
              typeof window !== "undefined" && window.location.hash === `#${submissionResultId(submission)}`;
            return (
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
              <details className="full-consensus-report" open={index === 0 || openFromUrl}>
                <summary>
                  <span>Full GenLayer consensus report</span>
                  {reportIdentity ? <small>{reportIdentity.split("_").join(" ")}</small> : null}
                </summary>
                <div className="report-body">
                  <div className="report-provenance">
                    <strong>Finalized GenLayer state</strong>
                    <p>
                      Report fields are rendered from finalized contract state. Independent validators verify the decision,
                      evidence gates, threshold side, and score tolerances. Narrative and rationale fields are the leader report
                      committed after validator agreement; individual validator narratives are not published.
                    </p>
                  </div>
                  {missingReportFields.length > 0 ? (
                    <div className="report-integrity-warning" role="status">
                      <strong>Incomplete on-chain report</strong>
                      <p>Contract fields not provided: {missingReportFields.join(", ")}. VerdictProof does not synthesize missing analysis.</p>
                    </div>
                  ) : null}
                  <section className="consensus-proof" aria-label="GenLayer consensus result">
                    <div>
                      <span className="panel-overline">Independent validator agreement</span>
                      {submission.validationMethod ? <h5>{validationMethodLabel(submission.validationMethod)}</h5> : null}
                      {submission.consensusChecks ? <p>{submission.consensusChecks.split("|").join(" · ")}</p> : null}
                    </div>
                    {reviewTx ? (
                      <div className="consensus-metrics">
                        <Metric label="Lifecycle" value={reviewTx.status.statusName} />
                        <Metric label="Result" value={reviewTx.status.resultName} />
                        <Metric label="Execution" value={reviewTx.status.executionResultName} />
                        {reviewTx.status.validatorsTotal > 0 ? (
                          <Metric
                            label="Validator votes"
                            value={`${reviewTx.status.validatorsAgreed}/${reviewTx.status.validatorsTotal} AGREE`}
                          />
                        ) : null}
                        <a href={explorerTx(reviewTx.hash)} target="_blank" rel="noreferrer">
                          Verify review transaction <ExternalLink size={12} />
                        </a>
                      </div>
                    ) : (
                      <div className="consensus-fallback">
                        <BadgeCheck size={18} />
                        <div>
                          <strong>State committed by GenLayer consensus</strong>
                          <p>Exact historical vote counts are unavailable without the review transaction hash.</p>
                          <a href={explorerContract()} target="_blank" rel="noreferrer">
                            Verify contract state <ExternalLink size={12} />
                          </a>
                        </div>
                      </div>
                    )}
                  </section>

                  <section className="report-context">
                    <div>
                      <span>Campaign task</span>
                      <p>{campaign?.taskInstruction ?? "Campaign task unavailable."}</p>
                    </div>
                    <div>
                      <span>Required proof</span>
                      <p>{campaign?.proofRequirement ?? "Campaign proof requirement unavailable."}</p>
                    </div>
                    <div>
                      <span>Tester wallet</span>
                      <p>{submission.tester}</p>
                    </div>
                    <div>
                      <span>Approval threshold</span>
                      <p>{campaign?.minimumScore ?? "—"}/100 · final score {submission.score}/100</p>
                    </div>
                    <div>
                      <span>Reward reservation</span>
                      <p>{formatGen(submission.reservedRewardAmount)} · {submission.reservationStatus}</p>
                    </div>
                  </section>

                  <div className="verification-grid" aria-label="Verified on-chain evidence checks">
                    <VerificationFact
                      label="Transaction receipt"
                      detail={`finalized_success=${String(submission.receiptChecks.finalized_success ?? false)}`}
                      passed={submission.transactionSuccess}
                    />
                    <VerificationFact
                      label="Tester wallet ownership"
                      detail={`sender_match=${String(submission.receiptChecks.sender_match ?? false)}`}
                      passed={submission.identityMatch}
                    />
                    <VerificationFact
                      label="Campaign task evidence"
                      detail={submission.taskAnalysis}
                      passed={submission.taskCompleted}
                    />
                  </div>

                  <section className="evidence-binding-report" aria-label="Exact campaign evidence binding">
                    <div className="report-section-head">
                      <span className="panel-overline">Evidence binding</span>
                      <h5>Exact facts returned by the Intelligent Contract</h5>
                    </div>
                    <div className="verification-grid">
                      <VerificationFact
                        label="Source contract"
                        detail={campaign?.receiptPolicy.source_contract ?? "Campaign binding unavailable."}
                        passed={submission.sourceContractMatch}
                      />
                      <VerificationFact
                        label="Expected method"
                        detail={campaign?.expectedMethod ?? "Campaign binding unavailable."}
                        passed={submission.methodMatch}
                      />
                      <VerificationFact
                        label="Exact task identifier"
                        detail={campaign ? `${campaign.receiptPolicy.task_identifier.selector} = ${String(campaign.receiptPolicy.task_identifier.value)}` : "Campaign binding unavailable."}
                        passed={submission.taskIdentifierMatch}
                      />
                      <VerificationFact
                        label="Exact deal"
                        detail={campaign ? `${campaign.receiptPolicy.deal.selector} = ${String(campaign.receiptPolicy.deal.value)}` : "Campaign binding unavailable."}
                        passed={Boolean(submission.receiptChecks.deal_match)}
                      />
                      <VerificationFact
                        label="Exact recipient"
                        detail={campaign ? `${campaign.receiptPolicy.recipient.selector} = ${String(campaign.receiptPolicy.recipient.value)}` : "Campaign binding unavailable."}
                        passed={Boolean(submission.receiptChecks.recipient_match)}
                      />
                      <VerificationFact
                        label="Exact amount (attoGEN)"
                        detail={campaign ? `${campaign.receiptPolicy.amount_atto.selector} = ${String(campaign.receiptPolicy.amount_atto.value)}` : "Campaign binding unavailable."}
                        passed={Boolean(submission.receiptChecks.amount_atto_match)}
                      />
                      <VerificationFact
                        label="Settlement kind"
                        detail={campaign ? `${campaign.receiptPolicy.kind.selector} = ${String(campaign.receiptPolicy.kind.value)}` : "Campaign binding unavailable."}
                        passed={Boolean(submission.receiptChecks.kind_match)}
                      />
                      <VerificationFact
                        label="Released state"
                        detail={campaign ? `${campaign.receiptPolicy.released.selector} = ${String(campaign.receiptPolicy.released.value)}` : "Campaign binding unavailable."}
                        passed={Boolean(submission.receiptChecks.released_match)}
                      />
                    </div>
                    <div className="review-detail-grid">
                      {Object.entries(submission.receiptChecks).map(([name, passed]) => (
                        <div key={name}><span>{name.split("_").join(" ")}</span><p>{String(passed)}</p></div>
                      ))}
                    </div>
                  </section>

                  <section className="evidence-binding-report" aria-label="Authenticated artifact provenance">
                    <div className="report-section-head">
                      <span className="panel-overline">Authenticated provenance</span>
                      <h5>{submission.provenanceManifest.canonical_origin}</h5>
                    </div>
                    <div className="review-detail-grid">
                      <div><span>Repository identity</span><p>{submission.provenanceManifest.owner}/{submission.provenanceManifest.repository} · ID {submission.provenanceManifest.repository_id}</p></div>
                      <div><span>Immutable version</span><p>{submission.commitSha}</p></div>
                      <div><span>Full SHA-256</span><p>{submission.artifactSha256}</p></div>
                      <div><span>Artifact</span><p>{submission.artifactByteLength} bytes · {submission.provenanceManifest.content_type}</p></div>
                    </div>
                  </section>

                  <section className="evidence-binding-report" aria-label="Complete artifact chunk review">
                    <div className="report-section-head">
                      <span className="panel-overline">Full-artifact coverage</span>
                      <h5>{submission.reviewedChunks.length}/{submission.totalChunks} chunks reviewed</h5>
                    </div>
                    <div className="review-detail-grid">
                      {submission.chunkDigests.map((digest, index) => (
                        <div key={digest}><span>Chunk {index}</span><p>{digest}</p></div>
                      ))}
                    </div>
                  </section>

                  <section className="evidence-binding-report" aria-label="Obligation assessments">
                    <div className="report-section-head">
                      <span className="panel-overline">Every accepted obligation</span>
                      <h5>{submission.obligationAssessments.length} contract-recorded assessments</h5>
                    </div>
                    <div className="review-detail-grid">
                      {submission.obligationAssessments.map((assessment) => (
                        <div key={assessment.obligation_id}>
                          <span>{assessment.obligation_id} · {assessment.verdict}</span>
                          <p>{assessment.reason_code} · {assessment.evidence_id} chunks {assessment.chunk_citations.join(", ")}</p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <div className="rubric-grid detailed-rubric" aria-label="GenLayer review score breakdown">
                    <RubricScore label="Proof" value={submission.proofScore} maximum={40} reason={submission.proofReason} />
                    <RubricScore label="Feedback" value={submission.feedbackScore} maximum={25} reason={submission.feedbackReason} />
                    <RubricScore label="Insight" value={submission.insightScore} maximum={20} reason={submission.insightReason} />
                    <RubricScore label="Originality" value={submission.originalityScore} maximum={15} reason={submission.originalityReason} />
                  </div>

                  <section className="evidence-links-panel">
                    <LinkChip
                      href={submission.transactionUrl}
                      label="Bradbury transaction evidence"
                      detail={compactUrlLabel(submission.transactionUrl)}
                      title="Open submitted transaction evidence"
                      external
                    />
                    {submission.artifactUrl ? <LinkChip
                      href={submission.artifactUrl}
                      label="Immutable GitHub artifact"
                      detail={submission.commitSha.slice(0, 12)}
                      title="Open authenticated artifact at its immutable commit"
                      external
                    /> : null}
                  </section>

                  <div className="review-detail-grid">
                    {submission.evidenceSummary ? <div>
                      <span>Evidence analysis</span>
                      <p>{submission.evidenceSummary}</p>
                    </div> : null}
                    {submission.improvementRecommendation ? <div>
                      <span>Recommendation</span>
                      <p>{submission.improvementRecommendation}</p>
                    </div> : null}
                    {submission.settlementExplanation ? <div>
                      <span>Settlement</span>
                      <p>{submission.settlementExplanation}</p>
                    </div> : null}
                    <div>
                      <span>Consumed evidence references</span>
                      <p>{submission.evidenceTransactionHash} · {submission.artifactKey}</p>
                    </div>
                    <div>
                      <span>Settlement record</span>
                      <p>{submission.settlementRecord.kind ?? "PENDING"} · recipient {submission.settlementRecord.recipient ?? "—"} · released {String(submission.settlementRecord.released ?? false)}</p>
                    </div>
                    {submission.riskFlags ? <div>
                      <span>Risk flags</span>
                      <p>{submission.riskFlags}</p>
                    </div> : null}
                  </div>
                </div>
              </details>
              <div className="history-links">
                {submission.riskFlags ? <span>{submission.riskFlags}</span> : null}
                <LinkChip
                  href={submission.transactionUrl}
                  label="Proof / tx note"
                  detail={compactUrlLabel(submission.transactionUrl)}
                  title="Open proof or transaction evidence"
                  external
                />
                <LinkChip
                  href={submissionResultHref(submission)}
                  label="Open full report"
                  detail={`Dashboard #${submission.campaignId}-${submission.submissionId}`}
                  title="Open the full GenLayer consensus report"
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
            );
          })}
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

function VerificationFact({ label, detail, passed }: { label: string; detail: string; passed: boolean }) {
  return (
    <div className={passed ? "verification-fact passed" : "verification-fact failed"}>
      {passed ? <CheckCircle2 size={14} /> : <X size={14} />}
      <div>
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </div>
  );
}

function RubricScore({
  label,
  value,
  maximum,
  reason
}: {
  label: string;
  value: number;
  maximum: number;
  reason?: string;
}) {
  return (
    <div className="rubric-score">
      <span>{label}</span>
      <strong>{value}/{maximum}</strong>
      {reason ? <p>{reason}</p> : null}
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
        <Metric label="Available" value={formatGen(campaign.rewardPool)} />
        <Metric label="Reserved" value={formatGen(campaign.reservedRewardPool)} />
        <Metric label="Reward" value={formatGen(campaign.rewardPerApproved)} />
        <Metric label="Open slots" value={String(campaign.availableRewardSlots)} />
      </div>
      <div className="campaign-binding-summary">
        <span>{shortAddress(campaign.expectedSourceContract)} · {campaign.expectedMethod}</span>
        <small>{campaign.expectedTaskIdentifier}</small>
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
  onExpire,
  walletAddress,
  onRequestClose,
  busy
}: {
  campaign: Campaign;
  submissions: Submission[];
  proofForm: ProofForm;
  setProofForm: (form: ProofForm) => void;
  onSubmitProof: (event: FormEvent) => void;
  onReview: (submission: Submission) => void;
  onExpire: (submission: Submission) => void;
  walletAddress: string | null;
  onRequestClose: (campaign: Campaign) => void;
  busy: string | null;
}) {
  const pendingCount = submissions.filter((submission) => submission.status === "PENDING").length;
  const isOwner = Boolean(walletAddress && campaign.owner.toLowerCase() === walletAddress.toLowerCase());
  const canClose = isOwner && campaign.status === "OPEN" && pendingCount === 0;

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
            <Metric label="Available rewards" value={formatGen(campaign.rewardPool)} />
            <Metric label="Pending reserved" value={formatGen(campaign.reservedRewardPool)} />
            <Metric label="Reward slots" value={String(campaign.availableRewardSlots)} />
            <Metric label="Tester reward" value={formatGen(campaign.rewardPerApproved)} />
            <Metric label="Stake required" value={formatGen(campaign.stakeRequired)} />
            <Metric label="Minimum score" value={`${campaign.minimumScore}/100`} />
          </div>

          <div className="campaign-binding-panel">
            <strong>Full-assurance evidence policy</strong>
            <p><span>Source contract</span>{campaign.expectedSourceContract}</p>
            <p><span>Method</span>{campaign.expectedMethod}</p>
            <p><span>Task identifier</span>{campaign.expectedTaskIdentifier}</p>
            <p><span>Repository</span>{campaign.repositoryIdentity.full_name}</p>
            <p><span>Artifact</span>{campaign.artifactPolicy.path} · {campaign.artifactPolicy.content_type}</p>
            <p><span>Deadline</span>{new Date(campaign.submissionDeadline * 1000).toLocaleString()}</p>
          </div>

          <details className="requirement-box" open>
            <summary><ClipboardCheck size={18} /><span>Accepted obligations</span></summary>
            {campaign.obligations.map((obligation) => <p key={obligation.id}><strong>{obligation.id}</strong> · {obligation.text}</p>)}
          </details>

          <details className="requirement-box">
            <summary>
              <Gauge size={18} />
              <span>Required proof</span>
            </summary>
            <p>{campaign.proofRequirement}</p>
          </details>
          {canClose ? (
            <div className="sponsor-close-panel">
              <div>
                <strong>Sponsor settlement ready</strong>
                <p>No pending submissions. Close this campaign and withdraw {formatGen(campaign.rewardPool)}.</p>
              </div>
              <button className="secondary-button danger-button" type="button" onClick={() => onRequestClose(campaign)}>
                <Banknote size={16} />
                Close & withdraw remaining pool
              </button>
            </div>
          ) : isOwner && campaign.status === "OPEN" && pendingCount > 0 ? (
            <p className="form-hint">{pendingCount} pending submission(s) must be reviewed before this campaign can close.</p>
          ) : null}
        </div>

        {campaign.status === "OPEN" && campaign.availableRewardSlots > 0 ? (
        <form className="proof-form" onSubmit={onSubmitProof}>
          <h4>Stake GEN & Submit Proof</h4>
          <label>
            Transaction URL
            <input
              spellCheck={false}
              required
              pattern="https://explorer-bradbury\\.genlayer\\.com/tx/0x[a-fA-F0-9]{64}.*"
              title="Use a complete Bradbury explorer transaction URL."
              placeholder="https://explorer-bradbury.genlayer.com/tx/..."
              value={proofForm.transactionUrl}
              onChange={(event) => setProofForm({ ...proofForm, transactionUrl: event.target.value })}
            />
          </label>
          <label>
            Immutable Git commit SHA
            <input
              spellCheck={false}
              required
              pattern="[a-fA-F0-9]{40}"
              placeholder="40-character commit SHA"
              value={proofForm.commitSha}
              onChange={(event) => setProofForm({ ...proofForm, commitSha: event.target.value })}
            />
          </label>
          <label>
            Full artifact SHA-256
            <input spellCheck={false} required pattern="[a-fA-F0-9]{64}" placeholder="64-character SHA-256" value={proofForm.artifactSha256} onChange={(event) => setProofForm({ ...proofForm, artifactSha256: event.target.value })} />
          </label>
          <label>
            Artifact byte length
            <input spellCheck={false} required type="number" min="1" max="4096" placeholder="1..4096" value={proofForm.artifactByteLength} onChange={(event) => setProofForm({ ...proofForm, artifactByteLength: event.target.value })} />
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
            The contract constructs the GitHub API URL from campaign policy and commit. Validators refetch all bytes, recompute SHA-256 and every chunk digest, then assess every obligation exactly once.
          </p>
          <button className="primary-button full" type="submit" disabled={busy === "submit"}>
            {busy === "submit" ? <Loader2 className="spin" size={16} /> : <Banknote size={16} />}
            Stake {formatGen(campaign.stakeRequired)} & Submit Proof
          </button>
        </form>
        ) : campaign.status === "OPEN" ? (
          <div className="proof-form closed-campaign-note">
            <h4>Reward capacity fully reserved</h4>
            <p>New submissions are blocked until pending reviews release a reservation or the campaign receives slashed stake.</p>
          </div>
        ) : (
          <div className="proof-form closed-campaign-note">
            <h4>Campaign closed</h4>
            <p>The sponsor withdrew the remaining pool. Existing approved claims remain available.</p>
          </div>
        )}

      </div>

      <div className="submissions-block">
        <h4>Campaign submissions</h4>
        {submissions.length > 0 ? (
          submissions.map((submission) => (
            <SubmissionRow
              key={submission.submissionId}
              submission={submission}
              onReview={onReview}
              onExpire={onExpire}
              busy={busy === `review-${submission.submissionId}` || busy === `expire-${submission.submissionId}`}
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
                label={
                  submission.status === "REJECTED" ? "Slashed" :
                  submission.status === "EXPIRED" ? "Refunded" :
                  submission.status === "PENDING" ? "Locked" :
                  submission.status === "CLAIMED" ? "Settled payout" : "Total claim"
                }
                value={
                  submission.status === "REJECTED" || submission.status === "EXPIRED" || submission.status === "PENDING"
                    ? formatGen(submission.stakeAmount)
                    : formatGen(submission.stakeAmount + submission.rewardAmount)
                }
              />
            </div>
            <p className="reason">{submission.reasonSummary}</p>
            {submission.riskFlags || submission.evidenceSummary ? (
              <div className="mini-review-detail">
                {submission.riskFlags ? <span>{submission.riskFlags}</span> : null}
                {submission.evidenceSummary ? <p>{submission.evidenceSummary}</p> : null}
              </div>
            ) : null}
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
  onExpire,
  busy
}: {
  submission: Submission;
  onReview: (submission: Submission) => void;
  onExpire: (submission: Submission) => void;
  busy: boolean;
}) {
  const canExpire = submission.status === "PENDING" && Math.floor(Date.now() / 1000) > submission.reviewDeadline;
  const stakeNote =
    submission.status === "PENDING"
      ? `Tester stake: ${formatGen(submission.stakeAmount)} locked in VerdictProof escrow until AI review finishes.`
      : submission.status === "APPROVED"
        ? `${formatGen(submission.stakeAmount)} stake is unlocked with ${formatGen(submission.rewardAmount)} reward available to claim.`
        : submission.status === "CLAIMED"
          ? `Stake and reward were claimed by ${shortAddress(submission.tester)}.`
          : submission.status === "EXPIRED"
            ? `${formatGen(submission.stakeAmount)} stake was refunded after the deterministic review timeout.`
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
        <button className="secondary-button" onClick={() => canExpire ? onExpire(submission) : onReview(submission)} disabled={busy}>
          {busy ? <Loader2 className="spin" size={15} /> : canExpire ? <Clock3 size={15} /> : <Sparkles size={15} />}
          {canExpire ? "Expire & refund stake" : "Run AI Review"}
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
        label="Open full report"
        detail={`Dashboard #${submission.campaignId}-${submission.submissionId}`}
        title="Open the full GenLayer consensus report"
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

function CloseCampaignModal({
  campaign,
  onConfirm,
  onClose,
  busy
}: {
  campaign: Campaign;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="close-campaign-title">
      <div className="modal close-campaign-modal">
        <div className="modal-head">
          <div>
            <span className="panel-overline">Sponsor settlement</span>
            <h3 id="close-campaign-title">Close Campaign #{campaign.campaignId}?</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close campaign confirmation">
            <X size={18} />
          </button>
        </div>
        <p>
          This permanently stops new proof submissions and returns the complete remaining reward pool to the campaign owner.
        </p>
        <div className="close-refund-amount">
          <span>Refund to sponsor</span>
          <strong>{formatGen(campaign.rewardPool)}</strong>
        </div>
        <p className="form-hint">Approved testers keep the right to claim stake plus rewards already reserved for them.</p>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>
            Keep campaign open
          </button>
          <button className="primary-button danger-button" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Banknote size={16} />}
            Close & withdraw {formatGen(campaign.rewardPool)}
          </button>
        </div>
      </div>
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
        <div className="binding-fieldset">
          <strong>Authenticated GitHub artifact</strong>
          <p className="form-hint">The contract constructs GitHub API requests and accepts only immutable UTF-8 artifacts up to 4 KiB.</p>
          <div className="form-grid">
            <label>GitHub owner<input required spellCheck={false} value={form.githubOwner} onChange={(event) => setForm({ ...form, githubOwner: event.target.value })} /></label>
            <label>Repository<input required spellCheck={false} value={form.githubRepository} onChange={(event) => setForm({ ...form, githubRepository: event.target.value })} /></label>
            <label>Artifact path<input required spellCheck={false} value={form.artifactPath} onChange={(event) => setForm({ ...form, artifactPath: event.target.value })} /></label>
            <label>Content type<select value={form.artifactContentType} onChange={(event) => setForm({ ...form, artifactContentType: event.target.value as CampaignForm["artifactContentType"] })}><option value="text/markdown">text/markdown</option><option value="text/plain">text/plain</option><option value="application/json">application/json</option></select></label>
            <label>Submission deadline<input required type="datetime-local" value={form.submissionDeadline} onChange={(event) => setForm({ ...form, submissionDeadline: event.target.value })} /></label>
          </div>
        </div>
        <div className="binding-fieldset">
          <strong>Every accepted obligation</strong>
          <p className="form-hint">Each validator must assess every ID exactly once and cite authenticated chunks.</p>
          {form.obligations.map((obligation, index) => (
            <div className="form-grid" key={`${index}-${obligation.id}`}>
              <label>Obligation ID<input required value={obligation.id} onChange={(event) => setForm({ ...form, obligations: form.obligations.map((item, itemIndex) => itemIndex === index ? { ...item, id: event.target.value } : item) })} /></label>
              <label>Obligation text<input required value={obligation.text} onChange={(event) => setForm({ ...form, obligations: form.obligations.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) })} /></label>
            </div>
          ))}
          <button type="button" className="secondary-button" disabled={form.obligations.length >= 8} onClick={() => setForm({ ...form, obligations: [...form.obligations, { id: `OBL-${String(form.obligations.length + 1).padStart(3, "0")}`, text: "" }] })}>Add obligation</button>
        </div>
        <div className="binding-fieldset">
          <strong>Exact finalized receipt facts</strong>
          <p className="form-hint">Selectors must use args.N or kwargs.identifier. Every value is enforced by the contract before approval.</p>
          <div className="form-grid">
            <label>Source contract<input required pattern="0x[a-fA-F0-9]{40}" value={form.sourceContract} onChange={(event) => setForm({ ...form, sourceContract: event.target.value })} /></label>
            <label>Method<input required pattern="[A-Za-z_][A-Za-z0-9_]*" value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })} /></label>
            <label>Task selector<input required value={form.taskIdentifierSelector} onChange={(event) => setForm({ ...form, taskIdentifierSelector: event.target.value })} /></label>
            <label>Task identifier<input required value={form.taskIdentifierValue} onChange={(event) => setForm({ ...form, taskIdentifierValue: event.target.value })} /></label>
            <label>Deal selector<input required value={form.dealSelector} onChange={(event) => setForm({ ...form, dealSelector: event.target.value })} /></label>
            <label>Deal ID<input required value={form.dealValue} onChange={(event) => setForm({ ...form, dealValue: event.target.value })} /></label>
            <label>Recipient selector<input required value={form.recipientSelector} onChange={(event) => setForm({ ...form, recipientSelector: event.target.value })} /></label>
            <label>Recipient value<input required pattern="0x[a-fA-F0-9]{40}" value={form.recipientValue} onChange={(event) => setForm({ ...form, recipientValue: event.target.value })} /></label>
            <label>Amount selector<input required value={form.amountSelector} onChange={(event) => setForm({ ...form, amountSelector: event.target.value })} /></label>
            <label>Amount atto<input required pattern="[0-9]+" value={form.amountAtto} onChange={(event) => setForm({ ...form, amountAtto: event.target.value })} /></label>
            <label>Kind selector<input required value={form.kindSelector} onChange={(event) => setForm({ ...form, kindSelector: event.target.value })} /></label>
            <label>Kind value<input required value={form.kindValue} onChange={(event) => setForm({ ...form, kindValue: event.target.value })} /></label>
            <label>Released selector<input required value={form.releasedSelector} onChange={(event) => setForm({ ...form, releasedSelector: event.target.value })} /></label>
            <label>Released value<select value={String(form.releasedValue)} onChange={(event) => setForm({ ...form, releasedValue: event.target.value === "true" })}><option value="true">true</option><option value="false">false</option></select></label>
          </div>
        </div>
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
