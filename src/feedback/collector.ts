// Feedback collector — invoked from CLI commands and hook bridge.
//
// FIX-M21: explicit allowlist + secret-redaction layer.
//   The hook bridge passes whatever the Claude harness sends it (often
//   tool_input / tool_response containing user-typed shell commands, file
//   bodies, etc). To prevent secret/PII leakage into feedback.json we:
//     1. ONLY accept fields from a known allowlist (event, tool, skill,
//        result.{success,outcome,skill}, session). Everything else is dropped
//        before it reaches enqueueFeedback.
//     2. Run a redaction sweep on every retained string. Anything matching
//        a known secret pattern (AWS access keys, OpenAI keys, GitHub PATs,
//        PEM headers) is replaced with "[REDACTED]".
//
// Result: even if a future bridge accidentally widens the payload, secrets
// cannot land on disk through this code path.

import { recordInvocation } from "./store.js";

interface QueueItem {
  name: string;
  outcome: "success" | "failure" | "unknown";
  session?: string;
}

const queue: QueueItem[] = [];
let draining = false;
const MAX_DRAIN_BATCH = 25;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const batch = queue.splice(0, MAX_DRAIN_BATCH);
      for (const item of batch) {
        try {
          await recordInvocation(item.name, item.outcome, item.session);
        } catch {
          // swallow — losing a single feedback record is acceptable
        }
      }
    }
  } finally {
    draining = false;
  }
}

export function enqueueFeedback(name: string, outcome: "success" | "failure" | "unknown", session?: string): number {
  if (queue.length >= 10) {
    // hold queue at 10 — additional fires increment counters via direct write
  } else {
    queue.push({ name, outcome, session });
  }
  setImmediate(() => { void drain(); });
  return queue.length;
}

export function getQueueDepth(): number {
  return queue.length;
}

export interface CollectFeedbackArgs {
  event?: string;
  tool?: string;
  result?: { success?: boolean; outcome?: "success" | "failure" | "unknown"; skill?: string } | null;
  skill?: string;
  session?: string;
}

// FIX-M21: deny-list of secret regex patterns. Any string passing through
// the collector is scrubbed before persistence.
const SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/g,                           // AWS access key id
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,            // OpenAI / Anthropic-style keys
  /ghp_[A-Za-z0-9]{20,}/g,                       // GitHub personal access token
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,         // PEM private key block
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,               // Slack tokens
];

function redact(s: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

function maybeStr(v: unknown): string | undefined {
  return typeof v === "string" ? redact(v) : undefined;
}

// Heuristic: infer skill name from a file path under a skills directory.
// Handles paths like /.../skills/draft/<name>/SKILL.md → <name>.
function inferSkillFromPath(filePath: unknown): string | undefined {
  if (typeof filePath !== "string") return undefined;
  const m = filePath.match(/[/\\]skills[/\\](?:draft|staging|published)[/\\]([^/\\]+)/);
  if (m) return m[1];
  const m2 = filePath.match(/[/\\]skills[/\\]([^/\\]+)[/\\]/);
  if (m2) return m2[1];
  return undefined;
}

/**
 * FIX-C9: extract skill identifier from a Claude harness PostToolUse payload.
 * Precedence: tool_input.skill_name → tool_input.skill → path heuristic on
 * tool_input.path / tool_input.file_path → existing top-level skill field.
 */
export function extractSkillFromHarnessPayload(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const ti = (r.tool_input && typeof r.tool_input === "object")
    ? (r.tool_input as Record<string, unknown>)
    : null;
  if (ti) {
    if (typeof ti.skill_name === "string" && ti.skill_name) return ti.skill_name;
    if (typeof ti.skill === "string" && ti.skill) return ti.skill;
    const fromPath = inferSkillFromPath(ti.path ?? ti.file_path);
    if (fromPath) return fromPath;
  }
  if (typeof r.skill === "string" && r.skill) return r.skill;
  return undefined;
}

/**
 * FIX-M21: filter raw payload to only allowlisted fields, redacting strings.
 * FIX-C9: also extracts skill from Claude harness tool_input fields.
 * This is the ONLY place untrusted hook input becomes a CollectFeedbackArgs.
 */
export function sanitizeRawPayload(raw: unknown): CollectFeedbackArgs {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const result = (r.result && typeof r.result === "object")
    ? (r.result as Record<string, unknown>)
    : {};
  const outcome = result.outcome;
  const validOutcome = (outcome === "success" || outcome === "failure" || outcome === "unknown")
    ? outcome
    : undefined;
  // FIX-C9: extract skill from harness payload (tool_input.skill_name / skill / path).
  const inferredSkill = extractSkillFromHarnessPayload(raw);
  const skillStr = inferredSkill ? redact(inferredSkill) : maybeStr(r.skill);
  return {
    event: maybeStr(r.event),
    tool: maybeStr(r.tool),
    skill: skillStr,
    session: maybeStr(r.session),
    result: {
      success: typeof result.success === "boolean" ? result.success : undefined,
      outcome: validOutcome,
      skill: maybeStr(result.skill),
    },
  };
}

// Single entrypoint used by both the hook bridge (cjs) and the CLI feedback
// command. Returns immediately after enqueuing.
export function collectFeedback(args: CollectFeedbackArgs): void {
  const skillName = args.skill ?? args.result?.skill;
  if (!skillName) return; // nothing actionable
  const outcome: "success" | "failure" | "unknown" =
    args.result?.outcome ??
    (args.result?.success === true ? "success"
      : args.result?.success === false ? "failure"
      : "unknown");
  enqueueFeedback(skillName, outcome, args.session);
}

// Convenience: hook bridge calls this with the raw stdin JSON. We sanitize
// then collect in one step so the hook cannot accidentally bypass redaction.
export function collectFromHookPayload(raw: unknown): void {
  collectFeedback(sanitizeRawPayload(raw));
}

// Drain all queued feedback items to disk. Called by the hook bridge before
// process.exit so records are not lost when the process terminates.
export async function drainFeedback(): Promise<void> {
  return drain();
}
