import { describe, it, expect, afterEach } from "vitest";
import { makeEnv } from "../_helpers.js";
import { incrementUsage, readFeedbackSync } from "../../src/feedback/store.js";
import type { FeedbackEntryWithHistogram } from "../../src/feedback/store.js";

let env: ReturnType<typeof makeEnv>;
afterEach(() => env?.cleanup());

describe("FIX-M18 — invocations cap + histogram", () => {
  it("1000 invocations → invocations.length <= 200, sum(histogram.hourly) + invocations.length === 1000", async () => {
    env = makeEnv();
    const name = "test-skill";
    // Run sequentially to avoid lock contention but still reach 1000
    for (let i = 0; i < 1000; i++) {
      await incrementUsage(name, "success");
    }
    const fb = readFeedbackSync();
    const entry = fb[name] as FeedbackEntryWithHistogram;
    expect(entry).toBeDefined();
    expect(entry.invocations.length).toBeLessThanOrEqual(200);
    const histogramSum = entry.invocationsHistogram
      ? entry.invocationsHistogram.hourly.reduce((a, b) => a + b, 0)
      : 0;
    expect(histogramSum + entry.invocations.length).toBe(1000);
  });
}, 60_000);
