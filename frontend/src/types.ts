export type CampaignStatus = "OPEN" | "PAUSED";
export type SubmissionStatus = "PENDING" | "APPROVED" | "REJECTED" | "CLAIMED";

export type Campaign = {
  campaignId: number;
  owner: string;
  title: string;
  productUrl: string;
  taskInstruction: string;
  proofRequirement: string;
  rewardPool: bigint;
  rewardPerApproved: bigint;
  stakeRequired: bigint;
  minimumScore: number;
  status: CampaignStatus;
  submissionCount: number;
  approvedCount: number;
  rejectedCount: number;
};

export type Submission = {
  submissionId: number;
  campaignId: number;
  campaignTitle: string;
  tester: string;
  transactionUrl: string;
  appResultUrl: string;
  feedbackText: string;
  stakeAmount: bigint;
  status: SubmissionStatus;
  score: number;
  approved: boolean;
  rewardAmount: bigint;
  transactionSuccess: boolean;
  identityMatch: boolean;
  taskCompleted: boolean;
  usageValid: boolean;
  feedbackQuality: string;
  proofScore: number;
  feedbackScore: number;
  insightScore: number;
  originalityScore: number;
  reasonSummary: string;
  evidenceSummary: string;
  improvementRecommendation: string;
  riskFlags: string;
  claimed: boolean;
};

export type CampaignForm = {
  title: string;
  productUrl: string;
  taskInstruction: string;
  proofRequirement: string;
  rewardPool: string;
  rewardPerApproved: string;
  stakeRequired: string;
  minimumScore: string;
};

export type ProofForm = {
  transactionUrl: string;
  appResultUrl: string;
  feedbackText: string;
};
