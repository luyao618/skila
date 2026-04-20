// Judge prompt assembly — explicitly references "tool sequence" as input
// (AC11/AC12). Three inputs: inventory, candidate, last-30 tool trace.
// FIX-C3: user-controlled regions are XML-fenced and capped to prevent injection.
export const JUDGE_INSTRUCTIONS = [
    "You are the skila judge. Decide whether the candidate insight is a NEW skill",
    "or an UPDATE to an existing one in the inventory. Your distillation MUST",
    "examine the **tool sequence** below — the trailing Edit/Bash/Grep calls are",
    "as significant as the natural-language candidate body.",
    "",
    "Return STRICT JSON:",
    '{ "decision": "NEW"|"UPDATE", "target_name": "<name>"|null, "similarity": <0..1>|null, "justification": "<text>", "suggested_version_bump": "patch"|"minor"|"major" }'
].join("\n");
const CANDIDATE_BODY_CAP = 8 * 1024; // 8 KB
const DESCRIPTION_CAP = 512; // 512 bytes
const TOOL_ARGS_CAP = 256; // 256 bytes per call
function capString(s, max) {
    if (s.length <= max)
        return s;
    return s.slice(0, max) + "…[truncated]";
}
function capToolArgs(args) {
    if (args === undefined || args === null)
        return "";
    const raw = JSON.stringify(args);
    if (raw.length <= TOOL_ARGS_CAP)
        return raw;
    // Check if a clean JSON truncation is possible (it usually won't be — use safe sentinel)
    return "<args omitted: too large>";
}
/** Strip control characters and HTML tags from a string (for changelog justification). */
export function sanitizeJustification(s) {
    // Remove HTML tags
    let out = s.replace(/<[^>]*>/g, "");
    // Remove control chars (0x00-0x1F except tab, newline, carriage return)
    out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
    return out;
}
export function formatToolTrace(trace) {
    return trace
        .slice(-30)
        .map((t, i) => {
        const args = capToolArgs(t.args);
        return `${i + 1}. ${t.tool}${args ? " " + args : ""}`;
    })
        .join("\n");
}
export function buildJudgePrompt(inputs) {
    const inventoryText = inputs.inventory.length === 0
        ? "(no existing skills)"
        : inputs.inventory
            .map((s) => `- ${s.name}: ${capString(s.frontmatter.description ?? "", DESCRIPTION_CAP)}`)
            .join("\n");
    const cappedBody = capString(inputs.candidate.body, CANDIDATE_BODY_CAP);
    const cappedDesc = capString(inputs.candidate.description, DESCRIPTION_CAP);
    const candidateText = `Name suggestion: ${inputs.candidate.name}\nDescription: ${cappedDesc}\n\nBody:\n${cappedBody}`;
    const toolTraceText = formatToolTrace(inputs.candidate.toolTrace);
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
        "</tool_trace>"
    ].join("\n");
    return { inventoryText, candidateText, toolTraceText, fullPrompt };
}
//# sourceMappingURL=prompt.js.map