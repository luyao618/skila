// tests/unit/test_install_hooks.ts
// FIX-M22: CLI dispatch for 'install-hooks' calls runInstallHooks.

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInstallHooks } from "../../src/commands/install-hooks.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) { try { c(); } catch {} }
  cleanups.length = 0;
});

function makeTempClaudeDir(): { claudeDir: string; settingsPath: string; cleanup: () => void } {
  const base = join(tmpdir(), `skila-install-hooks-${Math.random().toString(36).slice(2)}`);
  const claudeDir = join(base, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const settingsPath = join(claudeDir, "settings.json");
  return {
    claudeDir,
    settingsPath,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

describe("FIX-M22 — install-hooks subcommand", () => {
  it("creates ~/.claude/settings.json with PostToolUse and Stop hooks if absent", () => {
    const { claudeDir, settingsPath, cleanup } = makeTempClaudeDir();
    cleanups.push(cleanup);

    // Monkey-patch homedir to return our temp dir
    const origHome = process.env.HOME;
    // We'll pass settingsPath indirectly by testing the module directly
    // Since runInstallHooks uses homedir(), we need to override HOME
    const fakeHome = join(tmpdir(), `skila-fakeHome-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(fakeHome, ".claude"), { recursive: true });
    cleanups.push(() => rmSync(fakeHome, { recursive: true, force: true }));

    process.env.HOME = fakeHome;
    try {
      const result = runInstallHooks();
      expect(result.added.length).toBeGreaterThan(0);
      expect(existsSync(result.settingsPath)).toBe(true);
      const settings = JSON.parse(readFileSync(result.settingsPath, "utf8"));
      expect(settings.hooks).toBeDefined();
      expect(Array.isArray(settings.hooks.PostToolUse)).toBe(true);
      expect(Array.isArray(settings.hooks.Stop)).toBe(true);
      // At least one entry per event
      expect(settings.hooks.PostToolUse.length).toBeGreaterThan(0);
      expect(settings.hooks.Stop.length).toBeGreaterThan(0);
    } finally {
      process.env.HOME = origHome;
    }
  });

  it("is idempotent: running twice does not duplicate hook entries", () => {
    const fakeHome = join(tmpdir(), `skila-fakeHome2-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(fakeHome, ".claude"), { recursive: true });
    cleanups.push(() => rmSync(fakeHome, { recursive: true, force: true }));

    const origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      const r1 = runInstallHooks();
      const r2 = runInstallHooks();

      // Second run should skip all (already present)
      expect(r2.skipped.length).toBeGreaterThan(0);
      expect(r2.added.length).toBe(0);

      // No duplicates in settings
      const settings = JSON.parse(readFileSync(r1.settingsPath, "utf8"));
      const postHooks: unknown[] = settings.hooks.PostToolUse;
      const stopHooks: unknown[] = settings.hooks.Stop;
      // Each event should have exactly as many entries as were added the first time
      expect(postHooks.length).toBeGreaterThan(0);
      expect(stopHooks.length).toBeGreaterThan(0);
      // Ensure no duplicates (unique commands)
      const postCmds = postHooks.map((h: any) => h.command);
      expect(new Set(postCmds).size).toBe(postCmds.length);
    } finally {
      process.env.HOME = origHome;
    }
  });

  it("merges into existing settings.json without overwriting other keys", () => {
    const fakeHome = join(tmpdir(), `skila-fakeHome3-${Math.random().toString(36).slice(2)}`);
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    cleanups.push(() => rmSync(fakeHome, { recursive: true, force: true }));

    // Pre-write a settings.json with existing content
    const existing = { theme: "dark", hooks: { PostToolUse: [{ type: "command", command: "echo existing" }] } };
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify(existing));

    const origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      const result = runInstallHooks();
      const settings = JSON.parse(readFileSync(result.settingsPath, "utf8"));
      // Original key preserved
      expect(settings.theme).toBe("dark");
      // Existing hook still present
      expect(settings.hooks.PostToolUse.some((h: any) => h.command === "echo existing")).toBe(true);
      // Skila hook also added
      expect(settings.hooks.PostToolUse.some((h: any) => h.command.includes("skila"))).toBe(true);
    } finally {
      process.env.HOME = origHome;
    }
  });

  it("CLI dispatch: 'install-hooks' command succeeds via main()", async () => {
    const { main } = await import("../../src/cli.js");
    const fakeHome = join(tmpdir(), `skila-fakeHome4-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(fakeHome, ".claude"), { recursive: true });
    cleanups.push(() => rmSync(fakeHome, { recursive: true, force: true }));

    const origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      const code = await main(["install-hooks"]);
      expect(code).toBe(0);
    } finally {
      process.env.HOME = origHome;
    }
  });
});
