// Tests for translation API handlers
import { describe, it, expect, afterEach } from "vitest";
import { startServer } from "../../src/web/server.js";
import { loadConfig } from "../../src/config/config.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const c of closers.splice(0)) { try { await c(); } catch { } }
});

function setupEnv() {
  const home = join(tmpdir(), `skila-translate-test-${Date.now()}`);
  const skills = join(home, "skills");
  mkdirSync(skills, { recursive: true });
  mkdirSync(join(home, "judge-cache"), { recursive: true });
  mkdirSync(join(home, "logs"), { recursive: true });
  writeFileSync(join(home, ".adapter-mode"), "flat\n");
  process.env.SKILA_HOME = home;
  process.env.SKILA_SKILLS_ROOT = skills;
  return { home, cleanup: () => { if (existsSync(home)) rmSync(home, { recursive: true, force: true }); } };
}

async function spin(port: number) {
  const { port: p, close, token } = await startServer({ port });
  closers.push(close);
  return { base: `http://127.0.0.1:${p}`, token, close };
}

function headers(token: string) {
  return { "Content-Type": "application/json", "x-skila-token": token };
}

describe("translate API", () => {
  it("GET /api/settings/translate returns defaults", async () => {
    const { cleanup } = setupEnv();
    const { base, token, close } = await spin(18900);
    try {
      const r = await fetch(`${base}/api/settings/translate`, {
        headers: headers(token),
      });
      expect(r.status).toBe(200);
      const d = await r.json() as any;
      expect(d.targetLang).toBe("zh");
      expect(d.supportedLangs).toBeDefined();
      expect(typeof d.hasEnvApiKey).toBe("boolean");
    } finally { await close(); cleanup(); }
  });

  it("PUT /api/settings/translate saves settings", async () => {
    const { cleanup } = setupEnv();
    const { base, token, close } = await spin(18901);
    try {
      const r = await fetch(`${base}/api/settings/translate`, {
        method: "PUT",
        headers: headers(token),
        body: JSON.stringify({ targetLang: "ja", customBaseUrl: "http://localhost:9999" }),
      });
      expect(r.status).toBe(200);
      const cfg = loadConfig();
      expect(cfg.translateTargetLang).toBe("ja");
      expect(cfg.translateBaseUrl).toBe("http://localhost:9999");
    } finally { await close(); cleanup(); }
  });

  it("PUT /api/settings/translate requires token", async () => {
    const { cleanup } = setupEnv();
    const { base, close } = await spin(18902);
    try {
      const r = await fetch(`${base}/api/settings/translate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: "ko" }),
      });
      expect(r.status).toBe(403);
    } finally { await close(); cleanup(); }
  });

  it("POST /api/skills/nonexistent/translate returns 404", async () => {
    const { cleanup } = setupEnv();
    const { base, token, close } = await spin(18903);
    try {
      const r = await fetch(`${base}/api/skills/nonexistent-skill-xyz/translate`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ targetLang: "zh" }),
      });
      expect(r.status).toBe(404);
    } finally { await close(); cleanup(); }
  });

  it("POST /api/skills/:name/translate requires token", async () => {
    const { cleanup } = setupEnv();
    const { base, close } = await spin(18904);
    try {
      const r = await fetch(`${base}/api/skills/some-skill/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: "zh" }),
      });
      expect(r.status).toBe(403);
    } finally { await close(); cleanup(); }
  });
});
