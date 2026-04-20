import { describe, it, expect, afterEach, vi } from "vitest";
import { join } from "node:path";
import { makeEnv } from "../_helpers.js";
import { runDistill } from "../../src/commands/distill.js";
import * as judgeMod from "../../src/judge/judge.js";

let env: ReturnType<typeof makeEnv>;
afterEach(() => { env?.cleanup(); vi.restoreAllMocks(); });

describe("AC12 — judge hallucination guard", () => {
  it("UPDATE→does-not-exist → downgrade to NEW + structured warning + log line", async () => {
    env = makeEnv();
    vi.spyOn(judgeMod, "callJudge").mockResolvedValue({
      output: { decision: "UPDATE", target_name: "does-not-exist", similarity: 0.9, justification: "x", suggested_version_bump: "minor" },
      promptUsed: ""
    });
    const errs: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: any) => { errs.push(String(chunk)); return true; }) as any;
    try {
      const fixture = join(process.cwd(), "tests", "fixtures", "sessions", "session-1.md");
      const r = await runDistill({ fromFixture: fixture });
      expect(r.proposal.mode).toBe("NEW");
      expect(r.warnings.some((w) => w.type === "judge_hallucination" && w.proposed === "does-not-exist")).toBe(true);
      expect(errs.join("")).toMatch(/judge proposed UPDATE→does-not-exist but does-not-exist not found/);
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("UPDATE with null target_name → rejected with warning reason=update_without_target, no new draft created", async () => {
    env = makeEnv();
    vi.spyOn(judgeMod, "callJudge").mockResolvedValue({
      output: { decision: "UPDATE", target_name: null, similarity: 0.8, justification: "x", suggested_version_bump: "minor" },
      promptUsed: ""
    });
    const errs: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: any) => { errs.push(String(chunk)); return true; }) as any;
    try {
      const fixture = join(process.cwd(), "tests", "fixtures", "sessions", "session-1.md");
      const r = await runDistill({ fromFixture: fixture, dryRun: true });
      expect(r.proposal.mode).toBe("NEW");
      expect(r.warnings.some((w) => w.type === "judge_hallucination" && w.detail?.includes("update_without_target"))).toBe(true);
      expect(errs.join("")).toMatch(/target_name is empty/);
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("UPDATE with blank target_name → rejected with warning reason=update_without_target", async () => {
    env = makeEnv();
    vi.spyOn(judgeMod, "callJudge").mockResolvedValue({
      output: { decision: "UPDATE", target_name: "   ", similarity: 0.8, justification: "x", suggested_version_bump: "minor" },
      promptUsed: ""
    });
    const errs: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: any) => { errs.push(String(chunk)); return true; }) as any;
    try {
      const fixture = join(process.cwd(), "tests", "fixtures", "sessions", "session-1.md");
      const r = await runDistill({ fromFixture: fixture, dryRun: true });
      expect(r.proposal.mode).toBe("NEW");
      expect(r.warnings.some((w) => w.type === "judge_hallucination" && w.detail?.includes("update_without_target"))).toBe(true);
    } finally {
      process.stderr.write = origWrite;
    }
  });
});

