// Scenario C — refuse silent switch when sentinel ↔ on-disk reality disagree.
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAdapter, sentinelPath, resetAdapterCacheForTests } from "../../src/storage/index.js";

let home: string;
let savedHome: string | undefined;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "skila-no-silent-"));
  home = join(base, "skila-data");
  mkdirSync(home, { recursive: true });
  savedHome = process.env.SKILA_HOME;
  process.env.SKILA_HOME = home;
  resetAdapterCacheForTests();
});

afterEach(() => {
  resetAdapterCacheForTests();
  process.env.SKILA_HOME = savedHome;
  try { rmSync(home, { recursive: true, force: true }); } catch {}
});

describe("Scenario C — no silent adapter switch", () => {
  it("sentinel=git but .git/ deleted → throws with hint at `skila doctor --fix-storage`", async () => {
    // Pre-write sentinel saying git, but ensure .git/ is absent.
    writeFileSync(sentinelPath(home), "git\n");
    expect(existsSync(join(home, ".git"))).toBe(false);

    let captured: any = null;
    try { await getAdapter(); }
    catch (err) { captured = err; }
    expect(captured).not.toBeNull();
    expect(String(captured?.code)).toBe("E_ADAPTER_MISMATCH");
    expect(String(captured?.hint || "")).toMatch(/skila doctor --fix-storage/);
  });

  it("sentinel=flat but .git/ exists → throws with hint at `skila doctor --fix-storage`", async () => {
    writeFileSync(sentinelPath(home), "flat\n");
    mkdirSync(join(home, ".git"), { recursive: true });
    let captured: any = null;
    try { await getAdapter(); }
    catch (err) { captured = err; }
    expect(captured).not.toBeNull();
    expect(String(captured?.code)).toBe("E_ADAPTER_MISMATCH");
    expect(String(captured?.hint || "")).toMatch(/skila doctor --fix-storage/);
  });
});
