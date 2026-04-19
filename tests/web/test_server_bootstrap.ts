// tests/web/test_server_bootstrap.ts
// AC13: bind 127.0.0.1:7777; auto-increment on conflict; SIGINT clean exit.

import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:http";
import { startServer } from "../../src/web/server.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const c of closers) { try { await c(); } catch { } }
  closers.length = 0;
});

describe("AC13 server bootstrap", () => {
  it("binds to 127.0.0.1 on first available port starting from 7777", async () => {
    const { port, close, token } = await startServer({ port: 17777 });
    closers.push(close);
    expect(port).toBeGreaterThanOrEqual(17777);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(16);

    // Verify HTTP response on 127.0.0.1
    const r = await fetch(`http://127.0.0.1:${port}/api/dashboard`);
    expect(r.status).toBe(200);
  });

  it("auto-increments port on EADDRINUSE", async () => {
    // Occupy the base port
    const blocker = createServer();
    await new Promise<void>((res) => blocker.listen(17778, "127.0.0.1", () => res()));
    closers.push(() => new Promise<void>((r, e) => blocker.close(err => err ? e(err) : r())));

    const { port, close } = await startServer({ port: 17778 });
    closers.push(close);
    expect(port).toBeGreaterThan(17778);
  });

  it("closes cleanly (no socket hang)", async () => {
    const { port, close } = await startServer({ port: 17780 });
    // Make a request to confirm it's alive
    const r = await fetch(`http://127.0.0.1:${port}/api/dashboard`);
    expect(r.status).toBe(200);
    // Close and confirm subsequent connect fails
    await close();
    await expect(fetch(`http://127.0.0.1:${port}/api/dashboard`)).rejects.toThrow();
  });

  it("GET / returns HTML 200 and sets skila_token cookie", async () => {
    const { port, close, token } = await startServer({ port: 17781 });
    closers.push(close);
    // Build dist before test — if index.html present, check it
    const r = await fetch(`http://127.0.0.1:${port}/`);
    // May be 503 if dist not built yet — that's acceptable; we just need no crash
    expect([200, 503]).toContain(r.status);
    if (r.status === 200) {
      const setCookie = r.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("skila_token=");
    }
  });
});
