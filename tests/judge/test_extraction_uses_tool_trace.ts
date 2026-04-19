import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { makeEnv } from "../_helpers.js";
import { extractCandidateFromFixture } from "../../src/distill/extractor.js";
import { buildJudgePrompt } from "../../src/judge/prompt.js";

let env: ReturnType<typeof makeEnv>;
afterEach(() => env?.cleanup());

describe("AC12 — extractor + judge prompt explicitly use tool sequence", () => {
  it.each(["session-1.md", "session-2.md", "session-3.md"])(
    "%s exposes tool trace and prompt cites 'tool sequence'",
    (s) => {
      env = makeEnv();
      const cand = extractCandidateFromFixture(join(process.cwd(), "tests", "fixtures", "sessions", s));
      expect(Array.isArray(cand.toolTrace)).toBe(true);
      const out = buildJudgePrompt({ inventory: [], candidate: cand });
      expect(out.fullPrompt.toLowerCase()).toContain("tool sequence");
    }
  );
});
