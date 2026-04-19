// Judge prompt assembly — explicitly references "tool sequence" as input
// (AC11/AC12). Three inputs: inventory, candidate, last-30 tool trace.

import type { DistillCandidate, Skill, ToolTraceEntry } from "../types.js";

export const JUDGE_INSTRUCTIONS = [
  "You are the skila judge. Decide whether the candidate insight is a NEW skill",
  "or an UPDATE to an existing one in the inventory. Your distillation MUST",
  "examine the **tool sequence** below — the trailing Edit/Bash/Grep calls are",
  "as significant as the natural-language candidate body.",
  "",
  "Return STRICT JSON:",
  '{ "decision": "NEW"|"UPDATE", "target_name": "<name>"|null, "similarity": <0..1>|null, "justification": "<text>", "suggested_version_bump": "patch"|"minor"|"major" }'
].join("\n");

export function formatToolTrace(trace: ToolTraceEntry[]): string {
  return trace
    .slice(-30)
    .map((t, i) => {
      const args = t.args ? JSON.stringify(t.args).slice(0, 120) : "";
      return `${i + 1}. ${t.tool}${args ? " " + args : ""}`;
    })
    .join("\n");
}

export interface JudgePromptInputs {
  inventory: Skill[];
  candidate: DistillCandidate;
}

export function buildJudgePrompt(inputs: JudgePromptInputs): {
  inventoryText: string;
  candidateText: string;
  toolTraceText: string;
  fullPrompt: string;
} {
  const inventoryText = inputs.inventory.length === 0
    ? "(no existing skills)"
    : inputs.inventory
        .map((s) => `- ${s.name}: ${s.frontmatter.description ?? ""}`)
        .join("\n");
  const candidateText = `Name suggestion: ${inputs.candidate.name}\nDescription: ${inputs.candidate.description}\n\nBody:\n${inputs.candidate.body}`;
  const toolTraceText = formatToolTrace(inputs.candidate.toolTrace);
  const fullPrompt = [
    JUDGE_INSTRUCTIONS,
    "",
    "## Inventory",
    inventoryText,
    "",
    "## Candidate",
    candidateText,
    "",
    "## Tool sequence (last 30 tool calls in this session)",
    toolTraceText
  ].join("\n");
  return { inventoryText, candidateText, toolTraceText, fullPrompt };
}
