import { describe, it, expect, afterEach } from "vitest";
import { makeEnv } from "../_helpers.js";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readFeedbackSync, feedbackPath } from "../../src/feedback/store.js";
import { recordInvocation } from "../../src/feedback/store.js";

let env: ReturnType<typeof makeEnv>;
afterEach(() => env?.cleanup());

describe("FIX-M20 — schemaVersion envelope", () => {
  it("v0 file on disk is read correctly and written back as v1 without data loss", async () => {
    env = makeEnv();
    // Write a v0 file (raw FeedbackStoreShape)
    const v0Data = {
      "my-skill": {
        successRate: 1,
        usageCount: 5,
        failureCount: 0,
        lastUsedAt: "2024-01-01T00:00:00.000Z",
        invocations: [
          { ts: "2024-01-01T00:00:00.000Z", outcome: "success" }
        ]
      }
    };
    writeFileSync(feedbackPath(), JSON.stringify(v0Data, null, 2));

    // readFeedbackSync should transparently read v0
    const before = readFeedbackSync();
    expect(before["my-skill"]).toBeDefined();
    expect(before["my-skill"].usageCount).toBe(5);

    // Trigger a write by recording a new invocation
    await recordInvocation("my-skill", "success");

    // On-disk file should now be v1 envelope
    const raw = JSON.parse(readFileSync(feedbackPath(), "utf8"));
    expect(raw.schemaVersion).toBe(1);
    expect(raw.entries).toBeDefined();
    expect(raw.entries["my-skill"].usageCount).toBe(6);

    // readFeedbackSync should still work correctly on v1
    const after = readFeedbackSync();
    expect(after["my-skill"].usageCount).toBe(6);
  });
});
