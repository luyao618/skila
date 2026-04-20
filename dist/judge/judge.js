// LLM judge caller. Mock-mode default; JUDGE_LIVE=1 calls real Anthropic SDK.
// For Phase 2, the live path is stubbed with a TODO if no API key.
import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { buildJudgePrompt } from "./prompt.js";
// Mock fixture map: tests/fixtures/judge-responses/<sessionName>.json
function fixtureResponseFor(candidate) {
    const fixtureBase = candidate.fixturePath
        ? basename(candidate.fixturePath).replace(/\.md$/, "")
        : candidate.sessionId ?? candidate.name;
    // Try ./tests/fixtures/judge-responses
    const root = process.env.SKILA_FIXTURE_ROOT ?? join(process.cwd(), "tests", "fixtures", "judge-responses");
    const candidatesPaths = [
        join(root, `${fixtureBase}.json`),
        join(root, `${candidate.name}.json`)
    ];
    for (const p of candidatesPaths) {
        if (existsSync(p)) {
            try {
                return JSON.parse(readFileSync(p, "utf8"));
            }
            catch { /* fallthrough */ }
        }
    }
    return null;
}
function deterministicHeuristic(candidate, inventory) {
    // Match candidate name/desc tokens vs inventory.
    const tokens = (candidate.name + " " + candidate.description + " " + candidate.body).toLowerCase();
    let best = null;
    for (const sk of inventory) {
        const inv = (sk.name + " " + (sk.frontmatter.description ?? "")).toLowerCase();
        const invTokens = inv.split(/\W+/).filter(Boolean);
        let hits = 0;
        for (const t of invTokens) {
            if (t.length >= 4 && tokens.includes(t))
                hits++;
        }
        const score = invTokens.length === 0 ? 0 : hits / invTokens.length;
        if (!best || score > best.score)
            best = { name: sk.name, score };
    }
    if (best && best.score >= 0.4) {
        return {
            decision: "UPDATE",
            target_name: best.name,
            similarity: best.score,
            justification: `heuristic-match score=${best.score.toFixed(2)} with ${best.name}`,
            suggested_version_bump: "minor"
        };
    }
    return {
        decision: "NEW",
        target_name: null,
        similarity: best?.score ?? 0,
        justification: "heuristic: no inventory match",
        suggested_version_bump: "minor"
    };
}
export async function callJudge(args) {
    const { fullPrompt } = buildJudgePrompt(args);
    // Mock-mode: prefer fixture responses, fall back to heuristic.
    if (process.env.JUDGE_LIVE !== "1") {
        const fix = fixtureResponseFor(args.candidate);
        if (fix)
            return { output: fix, promptUsed: fullPrompt };
        return { output: deterministicHeuristic(args.candidate, args.inventory), promptUsed: fullPrompt };
    }
    // Live path: TODO when ANTHROPIC_API_KEY present. For Phase 2 we stub.
    if (!process.env.ANTHROPIC_API_KEY) {
        return { output: deterministicHeuristic(args.candidate, args.inventory), promptUsed: fullPrompt };
    }
    // TODO Phase 3: replace with real fetch to api.anthropic.com/v1/messages.
    return { output: deterministicHeuristic(args.candidate, args.inventory), promptUsed: fullPrompt };
}
//# sourceMappingURL=judge.js.map