// tests/mcp/test_smithery_mkdtemp.ts
// FIX-M16: smithery boot uses mkdtempSync (unpredictable path) + lstat-guarded prune.

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, symlinkSync, rmSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const created: string[] = [];
afterEach(() => {
  for (const p of created) { try { rmSync(p, { recursive: true, force: true }); } catch {} }
  created.length = 0;
});

describe("FIX-M16 — smithery uses mkdtempSync, refuses to follow symlinks", () => {
  it("createSmitheryHome returns a dir with random suffix (not just PID)", async () => {
    // Reset the cached active home by re-importing — but module-level state means
    // the test must run first or in isolation. Instead just check the format on the
    // ready signal of a fresh boot: see test_smithery_isolation for end-to-end.
    const mod: any = await import("../../src/commands/mcp.js");
    const home = mod.createSmitheryHome();
    created.push(home);
    expect(home.startsWith(tmpdir())).toBe(true);
    expect(home).toMatch(/skila-smithery-/);
    // mkdtempSync produces a 6-char random suffix on macOS/Linux (XXXXXX)
    const tail = home.split("skila-smithery-").pop() ?? "";
    expect(tail.length).toBeGreaterThanOrEqual(6);
  });

  it("pruneOrphanSmitheryDirs does NOT follow symlinks (security)", async () => {
    // Set up: a real outside dir + a symlink in /tmp pointing to it, with old mtime
    const outside = join(tmpdir(), `outside-victim-${Date.now()}`);
    mkdirSync(outside, { recursive: true });
    const sentinel = join(outside, "DO_NOT_DELETE.txt");
    writeFileSync(sentinel, "important");
    created.push(outside);

    const linkPath = join(tmpdir(), `skila-smithery-attacker-${Date.now()}`);
    symlinkSync(outside, linkPath);
    // Backdate "mtime" on the symlink target — though pruning should reject the link
    const old = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    try { utimesSync(linkPath, old, old); } catch {}

    const { pruneOrphanSmitheryDirs } = await import("../../src/commands/mcp.js");
    const removed = pruneOrphanSmitheryDirs();

    // The symlink itself should NOT be removed (lstat says it's a symlink, not dir)
    expect(removed.includes(linkPath)).toBe(false);
    // And the protected file outside MUST still exist
    expect(existsSync(sentinel)).toBe(true);

    // Cleanup the symlink
    try { rmSync(linkPath, { force: true }); } catch {}
  });
});
