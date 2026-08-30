export type CampaignStatus = "OPEN" | "PAUSED" | "CLOSED";
export type SubmissionStatus = "PENDING" | "APPROVED" | "REJECTED" | "CLAIMED" | "EXPIRED";

export type Obligation = { id: string; text: string };
export type ReceiptEntry = { selector: string; value: string | boolean };
export type ArtifactPolicy = { provider: "GITHUB"; auth_mode: "GITHUB_API"; owner: string; repository: string; path: string; content_type: "text/markdown" | "text/plain" | "application/json" };
export type ReceiptPolicy = { source_contract: string; method: string; task_identifier: ReceiptEntry; deal: ReceiptEntry; recipient: ReceiptEntry; amount_atto: ReceiptEntry; kind: ReceiptEntry; released: ReceiptEntry };
export type RepositoryIdentity = { repository_id: string; repository_node_id: string; owner_id: string; owner: string; repository: string; full_name: string };
export type SettlementRecord = { status?: string; kind?: string; recipient?: string; amount_atto?: string; released?: boolean };
export type ProvenanceManifest = { canonical_origin: string; repository_id: string; repository_node_id: string; owner_id: string; owner: string; repository: string; commit_sha: string; path: string; content_type: string; byte_length: number; blob_sha: string; sha256: string; total_chunks: number; chunk_digests: string[] };
export type ObligationAssessment = { obligation_id: string; verdict: "SATISFIED" | "VIOLATED"; evidence_id: "ARTIFACT_PRIMARY"; chunk_citations: number[]; reason_code: string };
export type ReceiptChecks = Record<string, boolean>;

export type Campaign = {
  campaignId: number; owner: string; title: string; productUrl: string; taskInstruction: string; proofRequirement: string;
  rewardPool: bigint; rewardPerApproved: bigint; stakeRequired: bigint; minimumScore: number; status: CampaignStatus;
  submissionCount: number; approvedCount: number; rejectedCount: number; expiredCount: number; reservedRewardPool: bigint; availableRewardSlots: number;
  revision: number; submissionDeadline: number; reviewTimeoutSeconds: number; obligations: Obligation[]; artifactPolicy: ArtifactPolicy;
  receiptPolicy: ReceiptPolicy; repositoryIdentity: RepositoryIdentity; closeSettlement: SettlementRecord | null; rubricVersion: string;
  expectedSourceContract: string; expectedMethod: string; expectedTaskIdentifier: string;
};

export type Submission = {
  submissionId: number; campaignId: number; campaignRevision: number; campaignTitle: string; tester: string; transactionUrl: string; feedbackText: string;
  stakeAmount: bigint; status: SubmissionStatus; submittedAt: number; reviewDeadline: number; commitSha: string; artifactKey: string; artifactUrl: string;
  provenanceManifest: ProvenanceManifest; artifactSha256: string; artifactByteLength: number; totalChunks: number; chunkDigests: string[];
  reservationStatus: "RESERVED" | "CONSUMED" | "RELEASED"; reservedRewardAmount: bigint; approved: boolean; claimed: boolean; rewardAmount: bigint;
  score: number; proofScore: number; feedbackScore: number; insightScore: number; originalityScore: number; taskCompleted: boolean; usageValid: boolean;
  receiptChecks: ReceiptChecks; obligationAssessments: ObligationAssessment[]; reviewedChunks: number[]; reasonSummary: string; evidenceSummary: string;
  improvementRecommendation: string; riskFlags: string; proofReason: string; feedbackReason: string; insightReason: string; originalityReason: string;
  taskAnalysis: string; settlementExplanation: string; settlementRecord: SettlementRecord; rubricVersion: string; validationMethod: string;
  consensusChecks: string; evidenceTransactionHash: string; transactionSuccess: boolean; identityMatch: boolean; sourceContractMatch: boolean; methodMatch: boolean; taskIdentifierMatch: boolean;
};

export type CampaignForm = {
  title: string; productUrl: string; taskInstruction: string; proofRequirement: string; rewardPool: string; rewardPerApproved: string; stakeRequired: string; minimumScore: string;
  submissionDeadline: string; obligations: Obligation[]; githubOwner: string; githubRepository: string; artifactPath: string; artifactContentType: ArtifactPolicy["content_type"];
  sourceContract: string; method: string; taskIdentifierSelector: string; taskIdentifierValue: string; dealSelector: string; dealValue: string;
  recipientSelector: string; recipientValue: string; amountSelector: string; amountAtto: string; kindSelector: string; kindValue: string; releasedSelector: string; releasedValue: boolean;
};

export type ProofForm = { transactionUrl: string; commitSha: string; artifactSha256: string; artifactByteLength: string; feedbackText: string };
