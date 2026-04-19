import { describe, it, expect } from "vitest";
import { callJudge } from "../../src/judge/judge.js";
import type { DistillCandidate } from "../../src/types.js";

describe("AC11 — judge output JSON shape", () => {
  it("returns required keys", async () => {
    const candidate: DistillCandidate = {
      name: "azure-pipeline-debug",
      description: "x",
      body: "x",
      toolTrace: [],
      fixturePath: "tests/fixtures/sessions/session-2.md"
    };
    const { output } = await callJudge({ candidate, inventory: [] });
    expect(output).toHaveProperty("decision");
    expect(output).toHaveProperty("similarity");
    expect(output).toHaveProperty("justification");
    expect(output).toHaveProperty("suggested_version_bump");
    expect(["NEW", "UPDATE"]).toContain(output.decision);
  });
});
