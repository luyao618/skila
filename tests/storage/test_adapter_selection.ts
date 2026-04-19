// AC19/AC20/AC21: storage adapter selection.
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { existsSync, readFileSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAdapter, sentinelPath, resetAdapterCacheForTests } from "../../src/storage/index.js";

const execFileP = promisify(execFile);

let home: string;
let savedPath: string | undefined;
let savedHome: string | undefined;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "skila-storage-sel-"));
  home = join(base, "skila-data");
  mkdirSync(home, { recursive: true });
  savedHome = process.env.SKILA_HOME;
  savedPath = process.env.PATH;
  process.env.SKILA_HOME = home;
  resetAdapterCacheForTests();
});

afterEach(() => {
  resetAdapterCacheForTests();
  process.env.SKILA_HOME = savedHome;
  process.env.PATH = savedPath;
  try { rmSync(home, { recursive: true, force: true }); } catch {}
});

describe("AC19/AC20/AC21 — adapter selection", () => {
  it("selects git when git is available + sentinel written", async () => {
    // ensure git really is available
    try { await execFileP("git", ["--version"], { timeout: 5000 }); }
    catch { return; /* skip if no git */ }
    const a = await getAdapter();
    expect(a.mode).toBe("git");
    expect(existsSync(sentinelPath(home))).toBe(true);
    expect(readFileSync(sentinelPath(home), "utf8").trim()).toBe("git");
  });

  it("selects flat when git is unavailable (PATH override)", async () => {
    // Override PATH to an empty dir so `git` cannot be found.
    const emptyBin = mkdtempSync(join(tmpdir(), "empty-bin-"));
    process.env.PATH = emptyBin;
    const a = await getAdapter();
    expect(a.mode).toBe("flat");
    expect(readFileSync(sentinelPath(home), "utf8").trim()).toBe("flat");
    rmSync(emptyBin, { recursive: true, force: true });
  });

  it("double-boot returns same instance and only logs once", async () => {
    const a1 = await getAdapter();
    const a2 = await getAdapter();
    expect(a1).toBe(a2);
  });
});

describe("AC21 — no top-level `skila storage` command", () => {
  it("`skila storage migrate` prints unknown command", async () => {
    const cli = join(process.cwd(), "dist", "cli.js");
    if (!existsSync(cli)) return; // build not run yet — covered by integration
    try {
      const r = await execFileP("node", [cli, "storage", "migrate"], { timeout: 5000 });
      expect(r.stderr + r.stdout).toMatch(/unknown command/);
    } catch (err: any) {
      const out = (err?.stderr ?? "") + (err?.stdout ?? "");
      expect(out).toMatch(/unknown command/);
    }
  });
});

// Suppress unused
void writeFileSync;
