import { describe, it, expect, afterEach } from "vitest";
import { existsSync, statSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { makeEnv } from "../_helpers.js";
import { collectFeedback, getQueueDepth } from "../../src/feedback/collector.js";
import { feedbackPath, recordInvocation } from "../../src/feedback/store.js";

let env: ReturnType<typeof makeEnv>;
afterEach(() => env?.cleanup());

describe("AC9 — feedback flywheel", () => {
  it("hook → feedback.json mtime delta ≤ 1000ms", async () => {
    env = makeEnv();
    const start = Date.now();
    await recordInvocation("azure-pipeline-debug", "success");
    const delta = Date.now() - start;
    expect(existsSync(feedbackPath())).toBe(true);
    expect(delta).toBeLessThanOrEqual(1000);
    const fb = JSON.parse(readFileSync(feedbackPath(), "utf8"));
    const fbEntries = fb.entries ?? fb;
    expect(fbEntries["azure-pipeline-debug"].usageCount).toBe(1);
  });

  it("burst test: 50 PostToolUse fires within 100ms → queueDepth ≤ 10", async () => {
    env = makeEnv();
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) {
      collectFeedback({ event: "PostToolUse", tool: "Edit", skill: "azure-pipeline-debug", result: { success: true } });
    }
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(100);
    expect(getQueueDepth()).toBeLessThanOrEqual(10);
  });
});
