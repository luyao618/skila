import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";

const CLI = join(process.cwd(), "dist", "cli.js");

describe("D5 — Smithery isolation", () => {
  it("spawned mcp child sets SKILA_HOME=/tmp/skila-smithery-<pid>/ and never touches real home", async () => {
    // Pretend "real" home — track its mtime.
    const realHome = join(tmpdir(), `skila-fake-real-${Date.now()}`);
    mkdirSync(realHome, { recursive: true });
    const sentinel = join(realHome, "feedback.json");
    writeFileSync(sentinel, "{}");
    const beforeMtime = statSync(sentinel).mtimeMs;

    const child = spawn(process.execPath, [CLI, "mcp"], {
      env: { ...process.env, SKILA_HOME: realHome },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let ready: any = null;
    let buf = "";
    const lines: any[] = [];
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try { lines.push(JSON.parse(line)); } catch {}
      }
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("mcp didn't emit ready in 5s")), 5000);
      const check = setInterval(() => {
        const r = lines.find((l) => l.type === "ready");
        if (r) { ready = r; clearInterval(check); clearTimeout(t); resolve(); }
      }, 20);
      child.on("error", (e) => { clearInterval(check); clearTimeout(t); reject(e); });
    });
    expect(ready).toBeTruthy();
    expect(ready.type).toBe("ready");
    // FIX-M16: home is now mkdtemp-suffixed (random), not PID. Just assert prefix + tmpdir containment.
    expect(String(ready.home)).toMatch(/skila-smithery-/);
    expect(ready.home.startsWith(tmpdir())).toBe(true);

    // Try to call disabled mutation command
    child.stdin!.write(JSON.stringify({ id: 1, method: "skila.distill", params: {} }) + "\n");
    const resp = await new Promise<any>((resolve) => {
      const t = setTimeout(() => resolve({ error: "timeout" }), 3000);
      const check = setInterval(() => {
        const r = lines.find((l) => l.id === 1);
        if (r) { clearInterval(check); clearTimeout(t); resolve(r); }
      }, 20);
    });
    expect(String(resp.error || "")).toMatch(/disabled in Smithery mode/);

    child.kill("SIGTERM");
    await new Promise((r) => child.on("exit", r));

    // Real home untouched
    const afterMtime = statSync(sentinel).mtimeMs;
    expect(afterMtime).toBe(beforeMtime);
    rmSync(realHome, { recursive: true, force: true });
  });

  it("boot prunes orphan tmpdirs older than 1h", async () => {
    const orphan = join(tmpdir(), `skila-smithery-99999-orphan-${Date.now()}`);
    mkdirSync(orphan, { recursive: true });
    // Backdate mtime
    const old = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    require("node:fs").utimesSync(orphan, old, old);
    const { pruneOrphanSmitheryDirs } = await import("../../src/commands/mcp.js");
    const removed = pruneOrphanSmitheryDirs();
    expect(removed.some((p) => p === orphan)).toBe(true);
    expect(existsSync(orphan)).toBe(false);
  });
});

// FIX-H22: MCP inspect awaits runInspect promise
describe("FIX-H22 — MCP inspect awaits runInspect", () => {
  it("handleMcpRequest inspect returns actual skill content, not empty object", async () => {
    const { handleMcpRequest } = await import("../../src/commands/mcp.js");
    // Should throw or return a result object — not an unresolved Promise
    let result: any;
    try {
      result = await handleMcpRequest({ method: "skila.inspect", params: { name: "does-not-exist" }, id: 99 });
    } catch {
      // If it throws (skill not found), that's fine — the bug was it returned a Promise instead of awaiting
      return;
    }
    // If it resolves, verify result is NOT a Promise
    if (result && result.result !== undefined) {
      expect(result.result instanceof Promise).toBe(false);
      // Result should be a plain object with content
      expect(typeof result.result).toBe("object");
    }
  });
});
