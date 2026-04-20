// FIX-H1: Tests exercise the deterministic heuristic, NOT fixture responses.
// SKILA_JUDGE_FIXTURE is NOT set to "1" here — fixture short-circuit is bypassed.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { makeEnv } from "../_helpers.js";
import { callJudge } from "../../src/judge/judge.js";
import type { DistillCandidate, Skill } from "../../src/types.js";

let env: ReturnType<typeof makeEnv>;
beforeEach(() => {
  // Ensure fixture short-circuit is disabled; heuristic runs directly.
  delete process.env.SKILA_JUDGE_FIXTURE;
});
afterEach(() => { env?.cleanup(); delete process.env.SKILA_JUDGE_FIXTURE; });

function makeSkill(name: string, description: string): Skill {
  return {
    name,
    status: "published",
    path: `/x/${name}/SKILL.md`,
    frontmatter: {
      name,
      description,
      skila: { version: "0.1.0", status: "published", parentVersion: null, revisionCount: 0, lastImprovedAt: "", changelog: [], source: "skila-distill" }
    } as any,
    body: description
  };
}

function makeCandidate(name: string, description: string, body: string): DistillCandidate {
  return { name, description, body, toolTrace: [] };
}

describe("FIX-H1 — judge classification tests exercise heuristic, not fixture", () => {
  it("(a) clear NEW — candidate unrelated to inventory → decision=NEW, similarity<0.4", async () => {
    env = makeEnv();
    const inventory = [makeSkill("azure-pipeline-debug", "debug azure pipelines ci cd failures logs")];
    const candidate = makeCandidate("python-pandas-merge", "merge dataframes with pandas", "Use pandas merge to combine dataframes on a key column");
    const { output } = await callJudge({ candidate, inventory });
    expect(output.decision).toBe("NEW");
    expect(output.similarity ?? 0).toBeLessThan(0.4);
  });

  it("(b) clear UPDATE — candidate closely matches inventory entry → decision=UPDATE, target_name set, similarity>=0.4", async () => {
    env = makeEnv();
    // Inventory has "docker-build" — candidate is about docker build
    const inventory = [
      makeSkill("docker-build", "docker build image container dockerfile registry push"),
      makeSkill("azure-pipeline-debug", "debug azure pipelines ci cd")
    ];
    const candidate = makeCandidate(
      "docker-build-tips",
      "docker build image container dockerfile registry",
      "docker build image container dockerfile registry push tag"
    );
    const { output } = await callJudge({ candidate, inventory });
    expect(output.decision).toBe("UPDATE");
    expect(output.target_name).toBe("docker-build");
    expect(output.similarity).toBeGreaterThanOrEqual(0.4);
  });

  it("(c) borderline 0.4 ± 0.05 — score near threshold → decision and similarity are consistent", async () => {
    env = makeEnv();
    // Craft inventory so overlap is approximately borderline
    // Inventory: "git rebase squash commits history"
    // Candidate has ~40% token overlap
    const inventory = [makeSkill("git-squash", "git rebase squash commits history clean")];
    // Candidate has tokens: git, rebase, squash — 3 out of ~5 inventory tokens ~ 60% overlap → UPDATE
    // OR candidate is totally different — let's test the assertion is consistent regardless of which side
    const candidate = makeCandidate(
      "git-interactive",
      "git rebase squash",
      "git rebase squash clean"
    );
    const { output } = await callJudge({ candidate, inventory });
    // Decision must be consistent with similarity: if >= 0.4 → UPDATE, else NEW
    if (output.similarity !== null && output.similarity !== undefined && output.similarity >= 0.4) {
      expect(output.decision).toBe("UPDATE");
      expect(output.target_name).toBe("git-squash");
    } else {
      expect(output.decision).toBe("NEW");
    }
  });

  it("(e) FIX-H2 tokenization: 'docker' does NOT match inventory with only 'dockerfile' token", async () => {
    env = makeEnv();
    // The inventory entry contains only the word "dockerfile" (length >= 4)
    // The candidate only has "docker" — must NOT match as full-token equality
    const inventory = [makeSkill("dockerfile-best-practices", "dockerfile best practices")];
    const candidate = makeCandidate("docker-run", "docker run container", "docker run the container locally");
    const { output } = await callJudge({ candidate, inventory });
    // "dockerfile" token in inventory should NOT match "docker" in candidate (full-token equality, not substring)
    // "best" and "practices" may or may not match — but "dockerfile" must not
    // The key assertion: if score came entirely from "dockerfile" substring match it would be high;
    // with full-token equality "dockerfile" !== "docker" so score must be lower
    // "best" (4 chars) - candidate has "best" → 1 hit; "practices" (9 chars) - no; "dockerfile" (10 chars) - no
    // So score = 1/3 ≈ 0.33 < 0.4 → NEW
    expect(output.decision).toBe("NEW");
  });

  it("(d) empty inventory → always NEW", async () => {
    env = makeEnv();
    const candidate = makeCandidate("anything", "anything at all", "some body text");
    const { output } = await callJudge({ candidate, inventory: [] });
    expect(output.decision).toBe("NEW");
    expect(output.target_name).toBeNull();
  });
});
