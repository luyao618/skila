// Shared TS types for skila Phase 2.

export type SkillStatus = "draft" | "staging" | "published" | "archived" | "disabled";

export interface SkillFrontmatter {
  name: string;
  description: string;
  compatibility?: { node?: string; python?: string };
  skila: {
    version: string;
    status: SkillStatus;
    parentVersion: string | null;
    revisionCount: number;
    lastImprovedAt: string;
    changelog: { version: string; date: string; change: string }[];
    source: "skila-distill" | "skila-revise" | "user-edit-via-web" | "skila-rollback";
  };
  [k: string]: unknown;
}

export interface Skill {
  name: string;
  status: SkillStatus;
  path: string;
  frontmatter: SkillFrontmatter;
  body: string;
}

export interface SkillProposal {
  name: string;
  mode: "NEW" | "UPDATE";
  targetName?: string;
  parentVersion?: string;
  newVersion: string;
  body: string;
  description: string;
  changelogEntry: string;
  warnings?: WarningRecord[];
}

export interface JudgeOutput {
  decision: "NEW" | "UPDATE";
  target_name?: string | null;
  similarity: number | null;
  justification: string;
  suggested_version_bump: "patch" | "minor" | "major";
}

export interface WarningRecord {
  type: "judge_hallucination" | "degraded_judge" | string;
  proposed?: string;
  detail?: string;
}

export interface FeedbackInvocation {
  ts: string;
  outcome: "success" | "failure" | "unknown";
  session?: string;
}

export interface FeedbackEntry {
  successRate: number;
  usageCount: number;
  failureCount: number;
  lastUsedAt: string;
  invocations: FeedbackInvocation[];
}

export type FeedbackStoreShape = Record<string, FeedbackEntry>;

export interface ToolTraceEntry {
  tool: string;
  args?: Record<string, unknown>;
  result?: string;
  ts?: string;
}

export interface DistillCandidate {
  name: string;
  description: string;
  body: string;
  toolTrace: ToolTraceEntry[];
  sessionId?: string;
  fixturePath?: string;
}
