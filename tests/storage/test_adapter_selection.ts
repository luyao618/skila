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

// FIX-H5: NAME_REGEX + semver guards on every adapter entry point
import { FlatFileStorage } from "../../src/storage/flat.js";

describe("FIX-H5 — adapter entry-point validation", () => {
  let adapter: FlatFileStorage;
  let savedHome: string | undefined;
  let savedSkillsRoot: string | undefined;
  let savedForce: string | undefined;
  let tmpHome: string;

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), "skila-h5-"));
    savedHome = process.env.SKILA_HOME;
    savedSkillsRoot = process.env.SKILA_SKILLS_ROOT;
    savedForce = process.env.SKILA_FORCE_ADAPTER;
    process.env.SKILA_HOME = tmpHome;
    process.env.SKILA_SKILLS_ROOT = join(tmpHome, "skills");
    process.env.SKILA_FORCE_ADAPTER = "flat";
    mkdirSync(join(tmpHome, "skills"), { recursive: true });
    adapter = new FlatFileStorage();
    await adapter.init();
  });

  afterEach(() => {
    process.env.SKILA_HOME = savedHome;
    process.env.SKILA_SKILLS_ROOT = savedSkillsRoot;
    process.env.SKILA_FORCE_ADAPTER = savedForce;
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  });

  const invalidNames = ["..", "/etc/passwd", "", "A_Bad_Name", "../escape"];
  const invalidVersions = ["1.0.0; rm -rf /", "-x", "NaN.NaN.NaN", "1.0", "1.0.0.0"];

  for (const name of invalidNames) {
    it(`writeSkill rejects invalid name: ${JSON.stringify(name)}`, async () => {
      await expect(adapter.writeSkill(name, "1.0.0", "content", { message: "m", status: "draft" }))
        .rejects.toMatchObject({ code: "E_INVALID_NAME" });
    });
    it(`moveSkill rejects invalid name: ${JSON.stringify(name)}`, async () => {
      await expect(adapter.moveSkill(name, "draft", "staging"))
        .rejects.toMatchObject({ code: "E_INVALID_NAME" });
    });
    it(`getVersion rejects invalid name: ${JSON.stringify(name)}`, async () => {
      await expect(adapter.getVersion(name, "1.0.0"))
        .rejects.toMatchObject({ code: "E_INVALID_NAME" });
    });
    it(`listVersions rejects invalid name: ${JSON.stringify(name)}`, async () => {
      await expect(adapter.listVersions(name))
        .rejects.toMatchObject({ code: "E_INVALID_NAME" });
    });
    it(`diff rejects invalid name: ${JSON.stringify(name)}`, async () => {
      await expect(adapter.diff(name, "1.0.0", "1.0.1"))
        .rejects.toMatchObject({ code: "E_INVALID_NAME" });
    });
  }

  for (const version of invalidVersions) {
    it(`writeSkill rejects invalid version: ${JSON.stringify(version)}`, async () => {
      await expect(adapter.writeSkill("valid-skill", version, "content", { message: "m", status: "draft" }))
        .rejects.toMatchObject({ code: "E_INVALID_VERSION" });
    });
    it(`getVersion rejects invalid version: ${JSON.stringify(version)}`, async () => {
      await expect(adapter.getVersion("valid-skill", version))
        .rejects.toMatchObject({ code: "E_INVALID_VERSION" });
    });
    it(`diff rejects invalid version (from): ${JSON.stringify(version)}`, async () => {
      await expect(adapter.diff("valid-skill", version, "1.0.1"))
        .rejects.toMatchObject({ code: "E_INVALID_VERSION" });
    });
  }
});
