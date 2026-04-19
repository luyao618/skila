import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { makeEnv } from "../_helpers.js";
import { extractCandidateFromFixture } from "../../src/distill/extractor.js";
import { callJudge } from "../../src/judge/judge.js";
import { scanInventory } from "../../src/inventory/scanner.js";

let env: ReturnType<typeof makeEnv>;
afterEach(() => env?.cleanup());

describe("AC11 — judge decision classification", () => {
  it("(a) unrelated → NEW", async () => {
    env = makeEnv({ withFixtureSkill: true });
    const cand = extractCandidateFromFixture(join(process.cwd(), "tests", "fixtures", "sessions", "session-1.md"));
    const inventory = scanInventory();
    const { output } = await callJudge({ candidate: cand, inventory });
    expect(output.decision).toBe("NEW");
  });
  it("(b) related-to-azure-pipeline-debug → UPDATE→azure-pipeline-debug", async () => {
    env = makeEnv({ withFixtureSkill: true });
    const cand = extractCandidateFromFixture(join(process.cwd(), "tests", "fixtures", "sessions", "session-2.md"));
    const inventory = scanInventory();
    const { output } = await callJudge({ candidate: cand, inventory });
    expect(output.decision).toBe("UPDATE");
    expect(output.target_name).toBe("azure-pipeline-debug");
  });
  it("(c) strong-similarity-different-domain → NEW with high similarity", async () => {
    env = makeEnv({ withFixtureSkill: true });
    const cand = extractCandidateFromFixture(join(process.cwd(), "tests", "fixtures", "sessions", "session-3.md"));
    const inventory = scanInventory();
    const { output } = await callJudge({ candidate: cand, inventory });
    expect(output.decision).toBe("NEW");
    expect(output.similarity ?? 0).toBeGreaterThanOrEqual(0.5);
  });
});
