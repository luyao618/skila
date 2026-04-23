// Judge prompt assembly — explicitly references "tool sequence" as input
// (AC11/AC12). Three inputs: inventory, candidate, last-30 tool trace.
// FIX-C3: user-controlled regions are XML-fenced and capped to prevent injection.

import type { DistillCandidate, Skill, SupportingFileCandidate, ToolTraceEntry } from "../types.js";

export const JUDGE_INSTRUCTIONS = [
  "You are the skila judge. Decide whether the candidate insight is a NEW skill",
  "or an UPDATE to an existing one in the inventory. Your distillation MUST",
  "examine the **tool sequence** below — the trailing Edit/Bash/Grep calls are",
  "as significant as the natural-language candidate body.",
  "",
  "",
  "Additionally, examine the tool sequence for reusable artifacts.",
  "Classify them according to Claude Code skill conventions:",
  "- scripts/: Executable code for tasks requiring deterministic reliability",
  "  or code that would be rewritten repeatedly",
  "- references/: Documentation to be loaded into context as needed",
  "  (schemas, API docs, domain knowledge)",
  "- assets/: Files used in output (templates, icons, boilerplate)",
  "  that should NOT be loaded into context",
  "",
  "Review any auto-detected candidates in the <supporting_files> section.",
  "For each, decide: KEEP, REMOVE, or MODIFY.",
  "Add any missing files you identify from the tool trace.",
  "",
  "Return enhanced JSON:",
  '{ "decision": "NEW"|"UPDATE", "target_name": "<name>"|null, "similarity": <0..1>|null,',
  '  "justification": "<text>", "suggested_version_bump": "patch"|"minor"|"major",',
  '  "supporting_files": [{"path":"scripts/x.sh","content":"...","action":"keep|remove|modify"}] | null,',
  '  "skill_body_references": ["See scripts/x.sh for ..."] | null }'
].join("\n");

const CANDIDATE_BODY_CAP = 8 * 1024;       // 8 KB
const DESCRIPTION_CAP = 512;               // 512 bytes
const TOOL_ARGS_CAP = 256;                 // 256 bytes per call

function capString(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…[truncated]";
}

function capToolArgs(args: unknown): string {
  if (args === undefined || args === null) return "";
  const raw = JSON.stringify(args);
  if (raw.length <= TOOL_ARGS_CAP) return raw;
  // Check if a clean JSON truncation is possible (it usually won't be — use safe sentinel)
  return "<args omitted: too large>";
}

/** Strip control characters and HTML tags from a string (for changelog justification). */
export function sanitizeJustification(s: string): string {
  // Remove HTML tags
  let out = s.replace(/<[^>]*>/g, "");
  // Remove control chars (0x00-0x1F except tab, newline, carriage return)
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return out;
}

export function formatToolTrace(trace: ToolTraceEntry[]): string {
  return trace
    .slice(-30)
    .map((t, i) => {
      const args = capToolArgs(t.args);
      return `${i + 1}. ${t.tool}${args ? " " + args : ""}`;
    })
    .join("\n");
}

export interface JudgePromptInputs {
  inventory: Skill[];
  candidate: DistillCandidate;
  supportingFileCandidates?: SupportingFileCandidate[];
}

export function buildJudgePrompt(inputs: JudgePromptInputs): {
  inventoryText: string;
  candidateText: string;
  toolTraceText: string;
  supportingFilesText: string;
  fullPrompt: string;
} {
  const inventoryText = inputs.inventory.length === 0
    ? "(no existing skills)"
    : inputs.inventory
        .map((s) => `- ${s.name}: ${capString(s.frontmatter.description ?? "", DESCRIPTION_CAP)}`)
        .join("\n");

  const cappedBody = capString(inputs.candidate.body, CANDIDATE_BODY_CAP);
  const cappedDesc = capString(inputs.candidate.description, DESCRIPTION_CAP);
  const candidateText = `Name suggestion: ${inputs.candidate.name}\nDescription: ${cappedDesc}\n\nBody:\n${cappedBody}`;
  const toolTraceText = formatToolTrace(inputs.candidate.toolTrace);

  const supportingFilesText = inputs.supportingFileCandidates?.length
    ? inputs.supportingFileCandidates
        .map((f, i) => `${i + 1}. ${f.path} (confidence: ${f.confidence.toFixed(1)}, type: ${f.fileType}) — "${f.reason}"`)
        .join("\n")
    : "(none detected)";

  const fullPrompt = [
    JUDGE_INSTRUCTIONS,
    "",
    "## Inventory",
    "<inventory>",
    inventoryText,
    "</inventory>",
    "",
    "## Candidate",
    "<candidate>",
    candidateText,
    "</candidate>",
    "",
    "## Tool sequence (last 30 tool calls in this session)",
    "<tool_trace>",
    toolTraceText,
    "</tool_trace>",
    "",
    "## Auto-detected Supporting File Candidates",
    "<supporting_files>",
    supportingFilesText,
    "</supporting_files>"
  ].join("\n");
  return { inventoryText, candidateText, toolTraceText, supportingFilesText, fullPrompt };
}
