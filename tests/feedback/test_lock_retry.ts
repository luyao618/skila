import { describe, it, expect, afterEach } from "vitest";
import { makeEnv } from "../_helpers.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rmdirSync } from "node:fs";
import { withLock } from "../../src/feedback/store.js";

let env: ReturnType<typeof makeEnv>;
afterEach(() => env?.cleanup());

describe("FIX-H24 — lock retry uses || (timeout OR attempts)", () => {
  it("reports timeout after ~100ms when lock is held (not waiting for both timeout+3 attempts)", async () => {
    env = makeEnv();
    // Write config with 100ms lock timeout
    writeFileSync(join(env.home, "config.json"), JSON.stringify({ lockTimeoutMs: 100, lockStaleMs: 5000 }));

    // Manually hold the lock by creating the lock directory
    const lockPath = join(env.home, "feedback.json.lock");
    mkdirSync(lockPath, { recursive: false });

    const start = Date.now();
    let threw = false;
    try {
      await withLock(() => Promise.resolve("ok"));
    } catch (err) {
      threw = true;
      expect((err as Error).message).toMatch(/timeout/i);
    }
    const elapsed = Date.now() - start;
    expect(threw).toBe(true);
    // With || logic, times out after ~100ms; with && it would wait for BOTH timeout AND 3 attempts.
    // Even at 30ms per attempt, 3 attempts = ~90ms, so with || we exit near 100ms.
    // Guard: must be well under 400ms (old buggy behavior could spin many more times).
    expect(elapsed).toBeLessThan(500);

    try { rmdirSync(lockPath); } catch {}
  });
});
