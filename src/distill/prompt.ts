// Distill prompt assembly (extractor side, not judge).

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
    input.sessionText,
    "",
    "## Tool sequence",
    input.toolTraceText
  ].join("\n");
}

export function summarizeCandidate(c: DistillCandidate): string {
  return `${c.name} — ${c.description}`;
}
