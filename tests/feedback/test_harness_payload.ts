// tests/feedback/test_harness_payload.ts
// FIX-C9: e2e test — real Claude PostToolUse JSON payload via collectFromHookPayload
// → feedback.json contains entry for the inferred skill.

import { describe, it, expect, afterEach } from "vitest";
import { makeEnv } from "../_helpers.js";
import { collectFromHookPayload, extractSkillFromHarnessPayload, drainFeedback } from "../../src/feedback/collector.js";
import { readFeedbackSync } from "../../src/feedback/store.js";

let env: ReturnType<typeof makeEnv>;
afterEach(() => env?.cleanup());

describe("FIX-C9 — harness payload skill extraction", () => {
  it("extracts skill_name from tool_input.skill_name", () => {
    const payload = {
      event: "PostToolUse",
      tool: "Bash",
      tool_input: { skill_name: "azure-pipeline-debug", command: "echo hi" },
      tool_response: "output",
    };
    expect(extractSkillFromHarnessPayload(payload)).toBe("azure-pipeline-debug");
  });

  it("extracts skill from tool_input.skill when skill_name absent", () => {
    const payload = {
      event: "PostToolUse",
      tool: "Read",
      tool_input: { skill: "my-custom-skill", path: "/tmp/foo.txt" },
    };
    expect(extractSkillFromHarnessPayload(payload)).toBe("my-custom-skill");
  });

  it("infers skill from tool_input.path under skills/draft/<name>/", () => {
    const payload = {
      event: "PostToolUse",
      tool: "Write",
      tool_input: { path: "/home/user/.claude/skills/draft/ci-fixer/SKILL.md" },
    };
    expect(extractSkillFromHarnessPayload(payload)).toBe("ci-fixer");
  });

  it("infers skill from tool_input.file_path under skills/staging/<name>/", () => {
    const payload = {
      event: "PostToolUse",
      tool: "Edit",
      tool_input: { file_path: "/Users/yao/.claude/skills/staging/pr-reviewer/prompt.md" },
    };
    expect(extractSkillFromHarnessPayload(payload)).toBe("pr-reviewer");
  });

  it("falls back to top-level skill field", () => {
    const payload = {
      event: "PostToolUse",
      skill: "fallback-skill",
      tool_input: {},
    };
    expect(extractSkillFromHarnessPayload(payload)).toBe("fallback-skill");
  });

  it("returns undefined when no skill identifier present", () => {
    const payload = { event: "PostToolUse", tool: "Bash", tool_input: { command: "ls" } };
    expect(extractSkillFromHarnessPayload(payload)).toBeUndefined();
  });
});

describe("FIX-C9 — e2e: real PostToolUse payload → feedback.json entry", () => {
  it("collectFromHookPayload with tool_input.skill_name writes entry to feedback.json", async () => {
    env = makeEnv();
    // Simulate a real Claude harness PostToolUse event with skill info in tool_input
    const postToolUsePayload = {
      event: "PostToolUse",
      tool: "Bash",
      session: "session-abc-123",
      tool_input: {
        skill_name: "azure-pipeline-debug",
        command: "echo test",
      },
      tool_response: "test",
      result: { success: true },
    };

    collectFromHookPayload(postToolUsePayload);
    await drainFeedback();

    const fb = readFeedbackSync();
    expect(fb["azure-pipeline-debug"]).toBeDefined();
    expect(fb["azure-pipeline-debug"]!.usageCount).toBeGreaterThanOrEqual(1);
  });

  it("collectFromHookPayload with path heuristic infers skill and writes entry", async () => {
    env = makeEnv();
    const postToolUsePayload = {
      event: "PostToolUse",
      tool: "Write",
      tool_input: {
        path: "/Users/yao/.claude/skills/draft/ci-fixer/SKILL.md",
        content: "# CI Fixer",
      },
      result: { success: true },
    };

    collectFromHookPayload(postToolUsePayload);
    await drainFeedback();

    const fb = readFeedbackSync();
    expect(fb["ci-fixer"]).toBeDefined();
    expect(fb["ci-fixer"]!.usageCount).toBe(1);
  });

  it("collectFromHookPayload with no skill info writes nothing", async () => {
    env = makeEnv();
    const postToolUsePayload = {
      event: "PostToolUse",
      tool: "Bash",
      tool_input: { command: "npm install" },
    };

    collectFromHookPayload(postToolUsePayload);
    await drainFeedback();

    const fb = readFeedbackSync();
    expect(Object.keys(fb)).toHaveLength(0);
  });
});
