// LLM judge caller. Mock-mode default; JUDGE_LIVE=1 calls real Anthropic SDK.
// For Phase 2, the live path is stubbed with a TODO if no API key.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import type { JudgeOutput, DistillCandidate, Skill, SupportingFileCandidate } from "../types.js";
import { buildJudgePrompt } from "./prompt.js";

export interface JudgeArgs {
  candidate: DistillCandidate;
  inventory: Skill[];
  supportingFileCandidates?: SupportingFileCandidate[];
}

// Mock fixture map: tests/fixtures/judge-responses/<sessionName>.json
function fixtureResponseFor(candidate: DistillCandidate): JudgeOutput | null {
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
        return JSON.parse(readFileSync(p, "utf8")) as JudgeOutput;
      } catch { /* fallthrough */ }
    }
  }
  return null;
}

const UPDATE_SIMILARITY_THRESHOLD = 0.4; // minimum overlap score to classify as UPDATE

function deterministicHeuristic(candidate: DistillCandidate, inventory: Skill[]): JudgeOutput {
  // Tokenize candidate: split on non-word chars, lowercase, full-token equality (not substring).
  const candTokens = new Set(
    (candidate.name + " " + candidate.description + " " + candidate.body)
      .toLowerCase()
      .split(/\W+/)
      .filter(Boolean)
  );
  let best: { name: string; score: number } | null = null;
  for (const sk of inventory) {
    const inv = (sk.name + " " + (sk.frontmatter.description ?? "")).toLowerCase();
    const invTokens = new Set(inv.split(/\W+/).filter(Boolean));
    if (invTokens.size === 0) {
      if (!best || 0 > best.score) best = { name: sk.name, score: 0 };
      continue;
    }
    let hits = 0;
    for (const t of invTokens) {
      if (t.length >= 4 && candTokens.has(t)) hits++;
    }
    const score = hits / Math.max(invTokens.size, 1);
    if (!best || score > best.score) best = { name: sk.name, score };
  }
  if (best && best.score >= UPDATE_SIMILARITY_THRESHOLD) {
    return {
      decision: "UPDATE",
      target_name: best.name,
      similarity: best.score,
      justification: `heuristic-match score=${best.score.toFixed(2)} with ${best.name}`,
      suggested_version_bump: "minor",
      supporting_files: undefined,
      skill_body_references: undefined
    };
  }
  return {
    decision: "NEW",
    target_name: null,
    similarity: best?.score ?? 0,
    justification: "heuristic: no inventory match",
    suggested_version_bump: "minor",
    supporting_files: undefined,
    skill_body_references: undefined
  };
}

export async function callJudge(args: JudgeArgs): Promise<{ output: JudgeOutput; promptUsed: string }> {
  const { fullPrompt } = buildJudgePrompt(args);
  // Mock-mode: prefer fixture responses (only when SKILA_JUDGE_FIXTURE=1), fall back to heuristic.
  if (process.env.JUDGE_LIVE !== "1") {
    if (process.env.SKILA_JUDGE_FIXTURE === "1") {
      const fix = fixtureResponseFor(args.candidate);
      if (fix) return { output: fix, promptUsed: fullPrompt };
    }
    return { output: deterministicHeuristic(args.candidate, args.inventory), promptUsed: fullPrompt };
  }
  // Live path: TODO when ANTHROPIC_API_KEY present. For Phase 2 we stub.
  if (!process.env.ANTHROPIC_API_KEY) {
    return { output: deterministicHeuristic(args.candidate, args.inventory), promptUsed: fullPrompt };
  }
  // TODO Phase 3: replace with real fetch to api.anthropic.com/v1/messages.
  return { output: deterministicHeuristic(args.candidate, args.inventory), promptUsed: fullPrompt };
}
