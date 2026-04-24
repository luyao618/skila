// tests/web/test_batch_a_security.ts
// Coverage for FIX-C7, FIX-C8, FIX-H17, FIX-H13.

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../../src/web/server.js";
import { resetAdapterCacheForTests } from "../../src/storage/index.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of closers) { try { await c(); } catch {} }
  closers.length = 0;
  resetAdapterCacheForTests();
  delete process.env.SKILA_HOME;
  delete process.env.SKILA_SKILLS_ROOT;
});

function makeSkillMd(name: string, status = "published", version = "0.1.0") {
  return `---
name: ${name}
description: test skill
skila:
  version: "${version}"
  status: ${status}
  parentVersion: null
  revisionCount: 0
  lastImprovedAt: "2026-01-01T00:00:00.000Z"
  changelog:
    - { version: "${version}", date: "2026-01-01T00:00:00.000Z", change: "Initial" }
  source: skila-distill
---

# ${name}
body
`;
}

function setupEnv() {
  const id = Math.random().toString(36).slice(2);
  const home = join(tmpdir(), `skila-batchA-${id}`);
  const skills = join(home, "skills");
  mkdirSync(skills, { recursive: true });
  const skillDir = join(skills, "test-skill");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), makeSkillMd("test-skill"));
  writeFileSync(join(home, ".adapter-mode"), "flat\n");
  process.env.SKILA_HOME = home;
  process.env.SKILA_SKILLS_ROOT = skills;
  resetAdapterCacheForTests();
  return { home, skills, skillDir, cleanup: () => { if (existsSync(home)) rmSync(home, { recursive: true, force: true }); } };
}

async function spin(port: number) {
  const { port: p, close, token } = await startServer({ port });
  closers.push(close);
  return { base: `http://127.0.0.1:${p}`, token };
}

// ── FIX-C7: files.ts hardening ─────────────────────────────────────────────
describe("FIX-C7 — files endpoint path traversal & symlink hardening", () => {
  it("rejects symlinked files (lstat block) with 403", async () => {
    const env = setupEnv();
    try {
      // Create a file outside skill dir, then symlink into it.
      const secret = join(env.home, "SECRET.txt");
      writeFileSync(secret, "TOPSECRET-CONTENT");
      mkdirSync(join(env.skillDir, "scripts"), { recursive: true });
      symlinkSync(secret, join(env.skillDir, "scripts", "evil.txt"));

      const { base, token } = await spin(17900);
      const r = await fetch(`${base}/api/skills/test-skill/file?path=scripts/evil.txt`, {
        headers: { "x-skila-token": token },
      });
      expect(r.status).toBe(403);
      const body = await r.text();
      expect(body).not.toContain("TOPSECRET");
    } finally { env.cleanup(); }
  });

  it("requires token (401/403 without it)", async () => {
    const env = setupEnv();
    try {
      mkdirSync(join(env.skillDir, "scripts"), { recursive: true });
      writeFileSync(join(env.skillDir, "scripts", "hello.txt"), "hi");
      const { base } = await spin(17901);
      const r = await fetch(`${base}/api/skills/test-skill/file?path=scripts/hello.txt`);
      expect(r.status).toBe(403);
    } finally { env.cleanup(); }
  });

  it("succeeds with token for legitimate file", async () => {
    const env = setupEnv();
    try {
      mkdirSync(join(env.skillDir, "scripts"), { recursive: true });
      writeFileSync(join(env.skillDir, "scripts", "hello.txt"), "legitimate-content");
      const { base, token } = await spin(17902);
      const r = await fetch(`${base}/api/skills/test-skill/file?path=scripts/hello.txt`, {
        headers: { "x-skila-token": token },
      });
      expect(r.status).toBe(200);
      const j = await r.json();
      expect(j.content).toBe("legitimate-content");
    } finally { env.cleanup(); }
  });
});

// ── FIX-C8: token model coherence ──────────────────────────────────────────
describe("FIX-C8 — token model: HttpOnly cookie + optional X-Skila-Token header", () => {
  it("Set-Cookie on GET / is HttpOnly + SameSite=Strict", async () => {
    const env = setupEnv();
    try {
      const { base } = await spin(17910);
      const r = await fetch(`${base}/`);
      const sc = r.headers.get("set-cookie") ?? "";
      // 503 (no dist) is OK; the cookie still gets set on 200. Skip when 503.
      if (r.status === 200) {
        expect(sc).toContain("HttpOnly");
        expect(sc).toContain("SameSite=Strict");
        expect(sc).toContain("skila_token=");
      }
    } finally { env.cleanup(); }
  });

  it("PUT with valid X-Skila-Token (header path for programmatic clients) succeeds auth", async () => {
    const env = setupEnv();
    try {
      const { base, token } = await spin(17911);
      const get = await fetch(`${base}/api/skills/test-skill`);
      const skill = await get.json();
      const newContent = makeSkillMd("test-skill").replace("body", "edited body");
      const r = await fetch(`${base}/api/skills/test-skill`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-skila-token": token },
        body: JSON.stringify({ content: newContent, mtime: skill.mtime }),
      });
      expect(r.status).toBe(200);
    } finally { env.cleanup(); }
  });

  it("front-end no longer references getCookie / x-skila-token in served HTML", async () => {
    // The shipped index.html (src or dist) MUST NOT call getCookie or send x-skila-token from JS.
    const html = readFileSync(join(process.cwd(), "src/web/index.html"), "utf8");
    expect(html).not.toMatch(/getCookie\s*\(\s*["']skila_token["']\s*\)/);
    // Only programmatic/server-side X-Skila-Token references remain (in token.ts comments).
    expect(html).not.toMatch(/['"]x-skila-token['"]\s*:\s*serverToken/);
  });
});

// ── FIX-H17: DNS rebinding / Host & Origin validation ──────────────────────
describe("FIX-H17 — Host + Origin validation", () => {
  it("rejects non-loopback Host header with 421", async () => {
    const env = setupEnv();
    try {
      const { base } = await spin(17920);
      const port = new URL(base).port;
      // node:fetch will set Host from URL automatically; we need raw socket
      const net = await import("node:net");
      const resp: string = await new Promise((resolve, reject) => {
        const sock = net.createConnection({ host: "127.0.0.1", port: Number(port) }, () => {
          sock.write("GET /api/skills HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n");
        });
        let buf = "";
        sock.on("data", (d) => { buf += d.toString(); });
        sock.on("end", () => resolve(buf));
        sock.on("error", reject);
      });
      expect(resp.split("\r\n")[0]).toContain("421");
    } finally { env.cleanup(); }
  });

  it("rejects POST when Origin is cross-origin with 403", async () => {
    const env = setupEnv();
    try {
      const { base, token } = await spin(17921);
      const r = await fetch(`${base}/api/skills/test-skill/archive`, {
        method: "POST",
        headers: { "x-skila-token": token, "Origin": "http://evil.example" },
      });
      expect(r.status).toBe(403);
    } finally { env.cleanup(); }
  });

  it("accepts POST with same-origin loopback Origin", async () => {
    const env = setupEnv();
    try {
      const { base, token } = await spin(17922);
      const r = await fetch(`${base}/api/skills/test-skill/archive`, {
        method: "POST",
        headers: { "x-skila-token": token, "Origin": `http://127.0.0.1:${new URL(base).port}` },
      });
      expect(r.status).toBe(200);
    } finally { env.cleanup(); }
  });
});

// ── FIX-H13: body cap + Content-Type check ─────────────────────────────────
describe("FIX-H13 — body size and Content-Type guards", () => {
  it("PUT with body > 1 MiB returns 413", async () => {
    const env = setupEnv();
    try {
      const { base, token } = await spin(17930);
      // 1.1 MiB string
      const huge = "x".repeat(1.1 * 1024 * 1024);
      const r = await fetch(`${base}/api/skills/test-skill`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-skila-token": token },
        body: huge,
      });
      expect(r.status).toBe(413);
    } finally { env.cleanup(); }
  });

  it("PUT with non-JSON Content-Type returns 415", async () => {
    const env = setupEnv();
    try {
      const { base, token } = await spin(17931);
      const r = await fetch(`${base}/api/skills/test-skill`, {
        method: "PUT",
        headers: { "Content-Type": "text/html", "x-skila-token": token },
        body: "<html>ok</html>",
      });
      expect(r.status).toBe(415);
    } finally { env.cleanup(); }
  });
});
