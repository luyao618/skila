import { describe, it, expect } from "vitest";
import { buildJudgePrompt } from "../../src/judge/prompt.js";
import type { DistillCandidate, Skill } from "../../src/types.js";

describe("AC11 — judge prompt contains 3 inputs + 'tool sequence' phrase (AC12)", () => {
  it("includes inventory, candidate, and last-30 tool trace", () => {
    const inventory: Skill[] = [{
      name: "azure-pipeline-debug",
      status: "published",
      path: "/x/SKILL.md",
      frontmatter: { name: "azure-pipeline-debug", description: "debug azure", skila: { version: "0.1.0", status: "published", parentVersion: null, revisionCount: 0, lastImprovedAt: "", changelog: [], source: "skila-distill" } } as any,
      body: "body"
    }];
    const candidate: DistillCandidate = {
      name: "x",
      description: "desc",
      body: "candidate body",
      toolTrace: Array.from({ length: 35 }, (_, i) => ({ tool: "Edit", args: { i } }))
    };
    const out = buildJudgePrompt({ inventory, candidate });
    expect(out.fullPrompt).toContain("azure-pipeline-debug");
    expect(out.fullPrompt).toContain("candidate body");
    expect(out.fullPrompt).toContain("tool sequence");
    // last-30 only — first entry should be 6 not 1
    expect(out.toolTraceText.split("\n").length).toBe(30);
  });
});
