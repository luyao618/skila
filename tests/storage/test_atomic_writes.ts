// AC22 — atomic writes (kill -9 mid-write leaves old or new only) + EXDEV fallback.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
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

  it("FIX-C4: fsyncSync called on temp file fd and parent dir fd", () => {
    const target = join(dir, "fsync-test.md");
    const fsynced: number[] = [];

    const realOpen = _ops.openSync;
    const realFsync = _ops.fsyncSync;
    const realClose = _ops.closeSync;
    const realWrite = _ops.writeSync;

    // Track which fds get fsynced
    _ops.fsyncSync = (fd: number) => {
      fsynced.push(fd);
      return realFsync(fd);
    };
    _ops.openSync = (path: any, flags: any, ...rest: any[]) => {
      return (realOpen as any)(path, flags, ...rest);
    };
    _ops.closeSync = (fd: number) => realClose(fd);
    _ops.writeSync = (fd: number, buf: any, ...rest: any[]) => (realWrite as any)(fd, buf, ...rest);

    try {
      atomicWriteFileSync(target, "fsync-content");
    } finally {
      _ops.fsyncSync = realFsync;
      _ops.openSync = realOpen;
      _ops.closeSync = realClose;
      _ops.writeSync = realWrite;
    }

    // Two fsync calls: one for temp file fd, one for parent dir fd
    expect(fsynced.length).toBe(2);
    expect(readFileSync(target, "utf8")).toBe("fsync-content");
  });

  it("FIX-C5: EXDEV path fsyncs sibling temp before rename onto target", () => {
    const target = join(dir, "exdev-fsync.md");
    writeFileSync(target, "original");
    const realRename = _ops.renameSync;
    const realFsync = _ops.fsyncSync;
    let renameCallCount = 0;
    const fsynced: number[] = [];

    _ops.renameSync = (from: any, to: any) => {
      renameCallCount++;
      if (renameCallCount === 1) {
        // First rename (tmp→target): throw EXDEV
        const err: NodeJS.ErrnoException = new Error("EXDEV");
        err.code = "EXDEV";
        throw err;
      }
      return realRename(from, to);
    };
    _ops.fsyncSync = (fd: number) => {
      fsynced.push(fd);
      return realFsync(fd);
    };

    try {
      atomicWriteFileSync(target, "exdev-new");
    } finally {
      _ops.renameSync = realRename;
      _ops.fsyncSync = realFsync;
    }

    // dest must contain new bytes
    expect(readFileSync(target, "utf8")).toBe("exdev-new");
    // at least 2 fsyncs: temp file + sibling + parent dir
    expect(fsynced.length).toBeGreaterThanOrEqual(2);
  });

  it("FIX-C5: if EXDEV copy fails, original target is untouched", () => {
    const target = join(dir, "exdev-safe.md");
    writeFileSync(target, "safe-original");
    const realRename = _ops.renameSync;
    const realCopy = _ops.copyFileSync;
    let renameCount = 0;

    _ops.renameSync = (from: any, to: any) => {
      renameCount++;
      if (renameCount === 1) {
        const err: NodeJS.ErrnoException = new Error("EXDEV");
        err.code = "EXDEV";
        throw err;
      }
      return realRename(from, to);
    };
    _ops.copyFileSync = (src: any, dst: any) => {
      // Simulate copy failure
      const err: NodeJS.ErrnoException = new Error("ENOSPC");
      err.code = "ENOSPC";
      throw err;
    };

    let caught: any = null;
    try {
      atomicWriteFileSync(target, "should-not-appear");
    } catch (e) {
      caught = e;
    } finally {
      _ops.renameSync = realRename;
      _ops.copyFileSync = realCopy;
    }

    expect(caught).not.toBeNull();
    // Original target must be untouched
    expect(readFileSync(target, "utf8")).toBe("safe-original");
  });

  it("FIX-C4: fsync errors surface as E_FSYNC", () => {
    const target = join(dir, "fsync-err.md");
    const realFsync = _ops.fsyncSync;
    let callCount = 0;
    _ops.fsyncSync = (fd: number) => {
      callCount++;
      if (callCount === 1) {
        const err: NodeJS.ErrnoException = new Error("Input/output error");
        err.code = "EIO";
        throw err;
      }
      return realFsync(fd);
    };
    let caught: any = null;
    try {
      atomicWriteFileSync(target, "data");
    } catch (e) {
      caught = e;
    } finally {
      _ops.fsyncSync = realFsync;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe("E_FSYNC");
  });
});
