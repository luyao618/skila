// Distill prompt assembly (extractor side, not judge).
export const EXTRACTION_PROMPT = [
    "Extract a single reusable skill candidate from the session below. Use the",
    "tool sequence (Edit/Bash/Grep/etc.) as primary signal. Return JSON:",
    '{ "name": "<slug>", "description": "<≤1024 chars>", "body": "<markdown>" }'
].join("\n");
export function buildExtractionPrompt(input) {
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
export function summarizeCandidate(c) {
    return `${c.name} — ${c.description}`;
}
//# sourceMappingURL=prompt.js.map