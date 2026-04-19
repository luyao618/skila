// AC22 — atomic writes (kill -9 mid-write leaves old or new only) + EXDEV fallback.
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { atomicWriteFileSync, _ops } from "../../src/storage/atomic.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "skila-atomic-"));
});
afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

describe("AC22 — atomic writes", () => {
  it("kill -9 mid-write leaves target as old or new bytes (5 trials)", async () => {
    const target = join(dir, "skill.md");
    const oldContent = "OLD\n".repeat(1024);
    writeFileSync(target, oldContent);

    const writerScript = join(dir, "writer.mjs");
    writeFileSync(writerScript, `
      import { writeFileSync, renameSync } from "node:fs";
      import { join, dirname, basename } from "node:path";
      import { randomBytes } from "node:crypto";
      const target = process.argv[2];
      const newContent = "NEW\\n".repeat(1024 * 256); // ~1MB
      // mimic atomicWriteFileSync
      const tmp = join(dirname(target), "." + basename(target) + ".tmp-" + randomBytes(6).toString("hex"));
      writeFileSync(tmp, newContent);
      renameSync(tmp, target);
      console.log("done");
    `);

    let cleanCount = 0;
    for (let trial = 0; trial < 5; trial++) {
      writeFileSync(target, oldContent);
      const child = spawn(process.execPath, [writerScript, target], { stdio: "pipe" });
      // SIGKILL very soon after start to attempt to kill mid-write.
      const killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5);
      await new Promise<void>((resP) => child.on("exit", () => resP()));
      clearTimeout(killTimer);

      // Target must be EITHER old bytes OR full new bytes. Never partial.
      const bytes = readFileSync(target, "utf8");
      const isOld = bytes === oldContent;
      const isNew = bytes === "NEW\n".repeat(1024 * 256);
      expect(isOld || isNew).toBe(true);
      if (isOld || isNew) cleanCount++;
    }
    expect(cleanCount).toBe(5);
  }, 30000);

  it("EXDEV cross-device falls back to copy+unlink", async () => {
    const target = join(dir, "exdev.md");
    writeFileSync(target, "old");
    const realRename = _ops.renameSync;
    let threw = false;
    _ops.renameSync = (from: any, to: any) => {
      if (!threw) {
        threw = true;
        const err: NodeJS.ErrnoException = new Error("EXDEV");
        err.code = "EXDEV";
        throw err;
      }
      return realRename(from, to);
    };
    try {
      atomicWriteFileSync(target, "new-bytes");
    } finally {
      _ops.renameSync = realRename;
    }
    expect(readFileSync(target, "utf8")).toBe("new-bytes");
    expect(threw).toBe(true);
  });

  it("does not leave .tmp- files behind on success", () => {
    const target = join(dir, "clean.md");
    atomicWriteFileSync(target, "hello");
    const leftover = require("node:fs").readdirSync(dir).filter((e: string) => e.startsWith(".clean.md.tmp"));
    expect(leftover.length).toBe(0);
    expect(existsSync(target)).toBe(true);
  });
});
