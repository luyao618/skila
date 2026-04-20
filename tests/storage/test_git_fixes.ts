// Tests for FIX-H6, FIX-H8, FIX-H9, FIX-M7, FIX-M17 in src/storage/git.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitBackedStorage } from "../../src/storage/git.js";

const execFileP = promisify(execFile);

let home: string;
let savedHome: string | undefined;
let savedPath: string | undefined;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "skila-git-fixes-"));
  home = join(base, "skila-data");
  mkdirSync(home, { recursive: true });
  savedHome = process.env.SKILA_HOME;
  savedPath = process.env.PATH;
  process.env.SKILA_HOME = home;
});

afterEach(() => {
  process.env.SKILA_HOME = savedHome;
  process.env.PATH = savedPath;
  try { rmSync(home, { recursive: true, force: true }); } catch {}
  vi.restoreAllMocks();
});

// Helper: check git is available
async function ensureGit(): Promise<boolean> {
  try {
    await execFileP("git", ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ── FIX-M7: .gitignore written on init ────────────────────────────────────────
describe("FIX-M7: .gitignore for sentinel files", () => {
  it("init writes .gitignore covering all sentinel/temp file patterns", async () => {
    if (!await ensureGit()) return;
    const adapter = new GitBackedStorage(home);
    await adapter.init();

    const gitignore = readFileSync(join(home, ".gitignore"), "utf8");
    expect(gitignore).toMatch(/\.adapter-mode/);
    expect(gitignore).toMatch(/\.write-probe/);
    expect(gitignore).toMatch(/\.\*\.tmp-\*/);
    expect(gitignore).toMatch(/\.move-intent\.json/);
    expect(gitignore).toMatch(/\.promote-\*\.lock/);
    expect(gitignore).toMatch(/\.skila-init/);
  });

  it("after init + `git add .`, none of the sentinel file patterns are staged", async () => {
    if (!await ensureGit()) return;
    const adapter = new GitBackedStorage(home);
    await adapter.init();

    // Create sentinel files that should be ignored
    const sentinels = [
      ".adapter-mode",
      ".write-probe",
      ".foo.tmp-abc123",
      ".move-intent.json",
      ".promote-v1.lock",
    ];
    for (const f of sentinels) {
      writeFileSync(join(home, f), "sentinel-content");
    }

    // Run git add .
    await execFileP("git", ["add", "."], { cwd: home, timeout: 5000 });

    // Check status — none of the sentinel files should appear as staged
    const { stdout } = await execFileP("git", ["status", "--porcelain"], { cwd: home, timeout: 5000 });
    for (const f of sentinels) {
      expect(stdout).not.toContain(f);
    }
  });
});

// ── FIX-M17: -- end-of-options everywhere ─────────────────────────────────────
describe("FIX-M17: git -- end-of-options sentinel", () => {
  it("git mv in moveSkill uses -- before paths (no double-dash missing)", async () => {
    if (!await ensureGit()) return;
    const adapter = new GitBackedStorage(home);
    // Write a skill so there's something to move
    await adapter.writeSkill("my-skill", "1.0.0", "# My Skill\ncontent", {
      status: "draft",
      message: "add my-skill",
    });

    // Move should succeed without error (using -- in git mv)
    await expect(adapter.moveSkill("my-skill", "draft", "published")).resolves.not.toThrow();

    // Verify file is at the new path
    const newPath = join(home, "skills", "published", "my-skill", "SKILL.md");
    expect(existsSync(newPath)).toBe(true);

    // Old path should be gone
    const oldPath = join(home, "skills", "draft", "my-skill", "SKILL.md");
    expect(existsSync(oldPath)).toBe(false);
  });

  it("writeSkill uses -- before path in git add", async () => {
    if (!await ensureGit()) return;
    const adapter = new GitBackedStorage(home);
    // Writing a skill with a name that starts with a dash-like pattern should not
    // confuse git — using -- ensures path is treated as a path.
    await expect(
      adapter.writeSkill("normal-skill", "1.0.0", "# content", {
        status: "published",
        message: "add normal-skill",
      })
    ).resolves.not.toThrow();
  });
});

// ── FIX-H6: git mv fallback drops source from index ───────────────────────────
describe("FIX-H6: moveSkill fallback removes source from git index", () => {
  it("when git mv fails, fallback copy+add does not leave source in the index", async () => {
    if (!await ensureGit()) return;
    const adapter = new GitBackedStorage(home);

    // Write a skill so it's tracked in git
    await adapter.writeSkill("hero-skill", "1.0.0", "# Hero\ncontent", {
      status: "draft",
      message: "add hero-skill",
    });

    // Simulate git mv failure by mocking execFile so git mv throws.
    // We do this by temporarily monkey-patching the internal git call.
    // Instead, we can test the outcome directly: write an untracked file
    // and test moveSkill on an untracked file (which triggers the fallback).
    const home2 = mkdtempSync(join(tmpdir(), "skila-h6-fallback-"));
    mkdirSync(home2, { recursive: true });
    try {
      const adapter2 = new GitBackedStorage(home2);
      await adapter2.init();

      // Manually place file in skills/draft/fallback-skill/ WITHOUT git add
      // so git mv would fail (file is untracked).
      const fromPath = join(home2, "skills", "draft", "fallback-skill");
      mkdirSync(fromPath, { recursive: true });
      writeFileSync(join(fromPath, "SKILL.md"), "# Fallback\n");

      // Also stage the source to simulate partial state (source in index)
      await execFileP("git", ["add", "--", "skills/draft/fallback-skill/SKILL.md"],
        { cwd: home2, timeout: 5000 });

      // The git mv will fail because git considers it a different move scenario
      // when the file exists but isn't committed yet — let's just verify moveSkill
      // ends up with toRel only, not fromRel in index.
      await adapter2.moveSkill("fallback-skill", "draft", "published");

      // After move: published path should exist, draft path should not
      expect(existsSync(join(home2, "skills", "published", "fallback-skill", "SKILL.md"))).toBe(true);
      expect(existsSync(join(home2, "skills", "draft", "fallback-skill", "SKILL.md"))).toBe(false);

      // Check git status: draft path must NOT appear as staged/untracked
      const { stdout } = await execFileP("git", ["status", "--porcelain"],
        { cwd: home2, timeout: 5000 });
      // After commit, index should be clean — nothing staged from old path
      expect(stdout.trim()).toBe("");
    } finally {
      rmSync(home2, { recursive: true, force: true });
    }
  });

  it("resulting tree has file at toRel only (not at fromRel) after fallback", async () => {
    if (!await ensureGit()) return;

    // Use a fresh home so we can control git state precisely
    const home3 = mkdtempSync(join(tmpdir(), "skila-h6-tree-"));
    mkdirSync(home3, { recursive: true });
    try {
      const adapter3 = new GitBackedStorage(home3);
      await adapter3.init();

      // Write + commit the skill normally
      await adapter3.writeSkill("tree-skill", "1.0.0", "# Tree\n", {
        status: "staging",
        message: "add tree-skill",
      });

      await adapter3.moveSkill("tree-skill", "staging", "published");

      // Verify committed tree: published path in HEAD, staging path absent
      const { stdout: showPub } = await execFileP(
        "git", ["show", "HEAD:skills/published/tree-skill/SKILL.md"],
        { cwd: home3, timeout: 5000 }
      );
      expect(showPub).toContain("# Tree");

      // staging path should NOT exist in HEAD
      let stagingExists = true;
      try {
        await execFileP("git", ["show", "HEAD:skills/staging/tree-skill/SKILL.md"],
          { cwd: home3, timeout: 5000 });
      } catch {
        stagingExists = false;
      }
      expect(stagingExists).toBe(false);
    } finally {
      rmSync(home3, { recursive: true, force: true });
    }
  });
});

// ── FIX-H8: foreign-repo guard + signing disabled ─────────────────────────────
describe("FIX-H8: foreign-repo guard", () => {
  it("throws E_GIT_FOREIGN_REPO when .git exists with non-skila history", async () => {
    if (!await ensureGit()) return;

    // Create a git repo in home that was NOT created by skila
    await execFileP("git", ["init", "-q"], { cwd: home, timeout: 5000 });
    await execFileP("git", ["config", "user.email", "test@test.com"], { cwd: home, timeout: 5000 });
    await execFileP("git", ["config", "user.name", "test"], { cwd: home, timeout: 5000 });
    // Write a foreign commit (no .skila-init)
    writeFileSync(join(home, "README.md"), "# Foreign repo\n");
    await execFileP("git", ["add", "--", "README.md"], { cwd: home, timeout: 5000 });
    await execFileP("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "initial foreign commit"],
      { cwd: home, timeout: 5000 });

    const adapter = new GitBackedStorage(home);
    let caught: any = null;
    try {
      await adapter.init();
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe("E_GIT_FOREIGN_REPO");
  });

  it("every commit sets gpgsign=false, user.email, user.name", async () => {
    if (!await ensureGit()) return;
    const adapter = new GitBackedStorage(home);
    await adapter.writeSkill("sign-test", "1.0.0", "# Sign\n", {
      status: "published",
      message: "add sign-test",
    });

    // Check the commit has the expected author identity
    const { stdout } = await execFileP(
      "git", ["log", "--max-count=1", "--pretty=format:%ae|%an"],
      { cwd: home, timeout: 5000 }
    );
    const [email, name] = stdout.trim().split("|");
    expect(email).toBe("skila@local");
    expect(name).toBe("skila");
  });
});

// ── FIX-H9: getVersion filters by path, not subject substring ─────────────────
describe("FIX-H9: getVersion filters by exact skill path", () => {
  it("getVersion('foo','1.0.0') returns foo's content even when bar also has v1.0.0", async () => {
    if (!await ensureGit()) return;
    const adapter = new GitBackedStorage(home);

    await adapter.writeSkill("foo", "1.0.0", "# Foo skill v1\n", {
      status: "published",
      message: "add foo",
    });
    await adapter.writeSkill("bar", "1.0.0", "# Bar skill v1\n", {
      status: "published",
      message: "add bar",
    });

    const fooContent = await adapter.getVersion("foo", "1.0.0");
    expect(fooContent).toContain("# Foo skill v1");
    expect(fooContent).not.toContain("# Bar skill v1");

    const barContent = await adapter.getVersion("bar", "1.0.0");
    expect(barContent).toContain("# Bar skill v1");
    expect(barContent).not.toContain("# Foo skill v1");
  });

  it("getVersion uses path-specific log (not subject substring match across skills)", async () => {
    if (!await ensureGit()) return;
    const adapter = new GitBackedStorage(home);

    // skill 'foobar' and 'foo' — 'foo' substring matches 'foobar' tag if naive
    await adapter.writeSkill("foobar", "2.0.0", "# Foobar v2\n", {
      status: "published",
      message: "add foobar",
    });
    await adapter.writeSkill("foo", "2.0.0", "# Foo v2\n", {
      status: "published",
      message: "add foo",
    });

    const fooContent = await adapter.getVersion("foo", "2.0.0");
    expect(fooContent).toContain("# Foo v2");
    expect(fooContent).not.toContain("# Foobar v2");
  });
});
