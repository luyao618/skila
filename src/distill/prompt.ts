// Distill prompt assembly (extractor side, not judge).
// FIX-C3: user-controlled regions are XML-fenced to prevent injection.

import type { DistillCandidate } from "../types.js";

export const EXTRACTION_PROMPT = [
  "Extract a single reusable skill candidate from the session below. Use the",
  "tool sequence (Edit/Bash/Grep/etc.) as primary signal. Return JSON:",
  '{ "name": "<slug>", "description": "<≤1024 chars>", "body": "<markdown>" }'
].join("\n");

export function buildExtractionPrompt(input: { sessionText: string; toolTraceText: string }): string {
  return [
    EXTRACTION_PROMPT,
    "",
    "## Session",
    "<candidate>",
    input.sessionText,
    "</candidate>",
    "",
    "## Tool sequence",
    "<tool_trace>",
    input.toolTraceText,
    "</tool_trace>"
  ].join("\n");
}

export function summarizeCandidate(c: DistillCandidate): string {
  return `${c.name} — ${c.description}`;
}

