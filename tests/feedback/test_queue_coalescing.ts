import { describe, it, expect, afterEach } from "vitest";
import { makeEnv } from "../_helpers.js";
import { enqueueFeedback, getQueueStats, drainFeedback } from "../../src/feedback/collector.js";
import { readFeedbackSync } from "../../src/feedback/store.js";

let env: ReturnType<typeof makeEnv>;
afterEach(() => env?.cleanup());

describe("FIX-H25 — queue coalescing (bounded backpressure)", () => {
  it("100 rapid enqueueFeedback('foo') → final usageCount === 100 after drain", async () => {
    env = makeEnv();
    for (let i = 0; i < 100; i++) {
      enqueueFeedback("foo", "success");
    }
    await drainFeedback();
    const fb = readFeedbackSync();
    expect(fb["foo"]?.usageCount).toBe(100);
  });

  it("getQueueStats returns dropCounters", () => {
    // This is a unit test of the API shape — no SKILA_HOME needed
    const stats = getQueueStats();
    expect(stats).toHaveProperty("depth");
    expect(stats).toHaveProperty("dropCounters");
  });
}, 30_000);
