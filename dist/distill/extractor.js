// Session memory + tool trace → DistillCandidate.
// In Phase 2 the runtime API for in-context memory isn't wired yet; instead
// `--from-fixture <session.md>` is the supported entry path used by all tests.
import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
export function loadFixtureSession(path) {
    if (!existsSync(path))
        throw new Error(`fixture not found: ${path}`);
    const sessionText = readFileSync(path, "utf8");
    const sessionId = basename(path).replace(/\.md$/, "");
    // Convention: trace lives at tests/fixtures/tool-traces/trace-<key>.json
    // where <key> is parsed from a `tool-trace: trace-foo` line in frontmatter
    // OR derived from the session filename (session-1 → trace-session-1).
    const fmMatch = sessionText.match(/tool-trace:\s*([\w.-]+)/);
    const traceName = fmMatch ? fmMatch[1] : `trace-${sessionId}`;
    const candidates = [
        join(dirname(path), "..", "tool-traces", `${traceName}.json`),
        join(dirname(path), "..", "tool-traces", `${traceName}`)
    ];
    let toolTrace = [];
    for (const p of candidates) {
        if (existsSync(p)) {
            try {
                toolTrace = JSON.parse(readFileSync(p, "utf8"));
                break;
            }
            catch { /* ignore */ }
        }
    }
    return { sessionText, toolTrace, sessionId };
}
// Synthesise a candidate from fixture session + trace. Heuristic only (deterministic
// for tests); real LLM extraction wires in Phase 3+.
export function extractCandidateFromFixture(path) {
    const { sessionText, toolTrace, sessionId } = loadFixtureSession(path);
    // Pull `name:` and `description:` from session frontmatter if present.
    const nameMatch = sessionText.match(/^name:\s*(.+)$/m);
    const descMatch = sessionText.match(/^description:\s*(.+)$/m);
    // Body = everything after first '---\n' frontmatter block, else whole file.
    let body = sessionText;
    if (sessionText.startsWith("---")) {
        const end = sessionText.indexOf("\n---", 3);
        if (end !== -1)
            body = sessionText.slice(end + 4).replace(/^\n/, "");
    }
    return {
        name: (nameMatch?.[1] ?? sessionId).trim(),
        description: (descMatch?.[1] ?? `Distilled from ${sessionId}`).trim(),
        body,
        toolTrace,
        sessionId,
        fixturePath: path
    };
}
//# sourceMappingURL=extractor.js.map