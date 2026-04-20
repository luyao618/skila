import { describe, it, expect, afterEach } from "vitest";
import { makeEnv } from "../_helpers.js";
import { recordInvocationSync } from "../../src/feedback/store.js";

let env: ReturnType<typeof makeEnv>;
afterEach(() => env?.cleanup());

describe("FIX-M19 — no busy-spin in recordInvocationSync", () => {
  it("CPU usage during 100 retries stays low (Atomics.wait yields CPU)", () => {
    env = makeEnv();
    const before = process.cpuUsage();
    for (let i = 0; i < 100; i++) {
      recordInvocationSync("cpu-test-skill", "success");
    }
    const delta = process.cpuUsage(before);
    const totalMicros = delta.user + delta.system;
    // 100 sequential writes should use well under 1 second of CPU (1_000_000 microseconds).
    // Busy-spin would spike this; Atomics.wait yields.
    expect(totalMicros).toBeLessThan(1_000_000);
  });
});
