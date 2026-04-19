import { describe, it, expect, afterEach } from "vitest";
import { makeEnv } from "../_helpers.js";
import { incrementUsage, readFeedbackSync } from "../../src/feedback/store.js";

let env: ReturnType<typeof makeEnv>;
afterEach(() => env?.cleanup());

describe("D6 — concurrent feedback writes", () => {
  it("100 concurrent incrementUsage(name) calls preserve usageCount === 100", async () => {
    env = makeEnv();
    const name = "azure-pipeline-debug";
    const tasks: Promise<unknown>[] = [];
    for (let i = 0; i < 100; i++) tasks.push(incrementUsage(name));
    await Promise.all(tasks);
    const fb = readFeedbackSync();
    expect(fb[name]?.usageCount).toBe(100);
  });
});
