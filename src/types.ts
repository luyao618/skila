// Shared TS types for skila Phase 2.

export type SkillStatus = "draft" | "staging" | "published" | "archived";
export type SkilaSource = "skila-distill" | "skila-revise" | "user-edit-via-web" | "skila-rollback";

/**
 * On-disk SKILL.md frontmatter shape (what Claude Code reads).
 * Skila bookkeeping lives in a sidecar `.skila.json` (see SkilaMetadata) and is
 * NOT stored here.
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  compatibility?: { node?: string; python?: string };
  [k: string]: unknown;
}

/**
 * Sidecar metadata stored in `<skill-dir>/.skila.json`.
 * Keeps version/changelog/etc. out of SKILL.md so the user-edited markdown
 * stays clean and round-trips byte-for-byte.
 */
export interface SkilaChangelogEntry {
  version: string;
  date: string;
  change: string;
}

export interface SkilaMetadata {
  version: string;
  status: SkillStatus;
  parentVersion: string | null;
  revisionCount: number;
  lastImprovedAt: string;
  changelog: SkilaChangelogEntry[];
  source?: SkilaSource;
}

export interface Skill {
  name: string;
  status: SkillStatus;
  path: string;
  frontmatter: SkillFrontmatter;
  body: string;
  skila: SkilaMetadata;
  supportingFiles?: string[];  // ["references/api.md", "scripts/fetch.py"]
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
  supportingFiles?: Array<{ path: string; content: string; fileType: SupportingFileType }>;
}

export interface JudgeOutput {
  decision: "NEW" | "UPDATE";
  target_name?: string | null;
  similarity: number | null;
  justification: string;
  suggested_version_bump: "patch" | "minor" | "major";
  supporting_files?: Array<{ path: string; content: string; action: "keep" | "remove" | "modify" }> | null;
  skill_body_references?: string[];
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
  supportingFiles?: SupportingFileCandidate[];
}

export type SupportingFileType = "scripts" | "references" | "assets";

export interface SupportingFileCandidate {
  path: string;              // "scripts/deploy.sh"
  content: string;
  fileType: SupportingFileType;
  source: "tool-trace" | "judge";
  confidence: number;        // 0-1
  reason: string;            // "Bash command repeated 3 times"
}
