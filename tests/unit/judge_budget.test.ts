import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeEnv } from "../_helpers.js";
import { buildBudgetedPrompt, writeInventoryCache, readInventoryCache } from "../../src/judge/budget.js";
import type { Skill } from "../../src/types.js";

let env: ReturnType<typeof makeEnv>;
afterEach(() => env?.cleanup());

function makeSkill(name: string, descLen: number, bodyLen: number, ts = "2026-04-19T00:00:00Z"): Skill {
  return {
    name, status: "published",
    path: `/x/${name}/SKILL.md`,
    frontmatter: {
      name, description: "x".repeat(descLen),
      skila: { version: "0.1.0", status: "published", parentVersion: null, revisionCount: 0, lastImprovedAt: ts, changelog: [], source: "skila-distill" }
    } as any,
    body: "y".repeat(bodyLen)
  };
}

describe("judge/budget — pre-check, atomic write, mode correctness", () => {
  it("throws E_BUDGET_TOO_SMALL when instructions alone exceed budget", () => {
    env = makeEnv();
    // Write a config with a tiny budget (10 tokens)
    writeFileSync(join(env.home, "config.json"), JSON.stringify({ judgeTokenBudget: 10 }));
    const bigInstr = "x".repeat(200); // ~50 tokens
    let threw = false;
    try {
      buildBudgetedPrompt({ inventory: [], candidateBody: "c", toolTraceText: "t", instructions: bigInstr });
    } catch (e: any) {
      threw = true;
      expect(e.code).toBe("E_BUDGET_TOO_SMALL");
    }
    expect(threw).toBe(true);
  });

  it("reports degraded (not full) when inventory is non-empty and mode is not full/cached", () => {
    env = makeEnv();
    // Use a huge inventory to force the degraded path
    const inv = Array.from({ length: 200 }, (_, i) => makeSkill(`skill-${i}`, 800, 4000, `2026-01-${(i % 28) + 1}T00:00:00Z`));
    const out = buildBudgetedPrompt({
      inventory: inv,
      candidateBody: "huge candidate ".repeat(2000),
      toolTraceText: "trace ".repeat(2000),
      instructions: "INSTR",
    });
    expect(out.mode).toBe("degraded");
  });

  it("writeInventoryCache uses atomic write (readable after write)", () => {
    env = makeEnv();
    writeInventoryCache("testhash123", "some summary text");
    const result = readInventoryCache("testhash123");
    expect(result).toBe("some summary text");
  });
});

describe("judge/budget — full → degraded → cached transitions", () => {
  it("small inventory → full mode", () => {
    env = makeEnv();
    const out = buildBudgetedPrompt({ inventory: [makeSkill("a", 50, 100)], candidateBody: "candidate", toolTraceText: "trace", instructions: "INSTR" });
    expect(["full", "cached"]).toContain(out.mode);
    expect(out.tokens).toBeLessThanOrEqual(4000);
  });

  it("huge inventory forces degraded mode", () => {
    env = makeEnv();
    const inv = Array.from({ length: 200 }, (_, i) => makeSkill(`skill-${i}`, 800, 4000, `2026-01-${(i % 28) + 1}T00:00:00Z`));
    const out = buildBudgetedPrompt({ inventory: inv, candidateBody: "huge candidate ".repeat(2000), toolTraceText: "trace ".repeat(2000), instructions: "INSTR" });
    expect(out.mode).toBe("degraded");
    expect(out.tokens).toBeLessThanOrEqual(4000 * 1.05); // small slack for boundary
  });

  it("second build with identical inventory is served from cache", () => {
    env = makeEnv();
    const inv = [makeSkill("a", 50, 100)];
    buildBudgetedPrompt({ inventory: inv, candidateBody: "c", toolTraceText: "t", instructions: "I" });
    const out2 = buildBudgetedPrompt({ inventory: inv, candidateBody: "c", toolTraceText: "t", instructions: "I" });
    expect(out2.mode).toBe("cached");
  });
});
