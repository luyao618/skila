// tests/web/test_phase1_xss_csp.ts
// Phase 1 regression: Markdown preview sanitization + hash-based CSP.
//
// The two guarantees under test:
//   1. Markdown rendered into innerHTML cannot introduce script execution.
//      SKILL.md content can originate from an LLM or an external file, and the
//      auth cookie rides along on same-origin requests, so an injected script
//      would get authenticated write access to the API.
//   2. The CSP served to the browser no longer contains 'unsafe-inline' for
//      scripts, and the inline-script hashes come from the built artifact.

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { startServer } from "../../src/web/server.js";
import { resetAdapterCacheForTests } from "../../src/storage/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST_WEB = join(ROOT, "dist", "web");

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of closers) { try { await c(); } catch {} }
  closers.length = 0;
  resetAdapterCacheForTests();
  delete process.env.SKILA_HOME;
  delete process.env.SKILA_SKILLS_ROOT;
});

function setupEnv() {
  const id = Math.random().toString(36).slice(2);
  const home = join(tmpdir(), `skila-phase1-${id}`);
  const skills = join(home, "skills");
  mkdirSync(skills, { recursive: true });
  writeFileSync(join(home, ".adapter-mode"), "flat\n");
  process.env.SKILA_HOME = home;
  process.env.SKILA_SKILLS_ROOT = skills;
  resetAdapterCacheForTests();
  return { home, cleanup: () => { if (existsSync(home)) rmSync(home, { recursive: true, force: true }); } };
}

async function spin(port: number) {
  const { port: p, close } = await startServer({ port });
  closers.push(close);
  return `http://127.0.0.1:${p}`;
}

describe("Phase 1 — CSP no longer allows inline script execution", () => {
  it("script-src has no 'unsafe-inline'", async () => {
    const env = setupEnv();
    try {
      const base = await spin(17960);
      const csp = (await fetch(`${base}/api/dashboard`)).headers.get("content-security-policy") ?? "";
      const scriptSrc = csp.split(";").map(s => s.trim()).find(s => s.startsWith("script-src")) ?? "";
      expect(scriptSrc).not.toBe("");
      expect(scriptSrc).not.toContain("unsafe-inline");
      // 'unsafe-hashes' would re-enable inline event handlers — the whole
      // reason the two onclick= attributes became addEventListener.
      expect(scriptSrc).not.toContain("unsafe-hashes");
      expect(scriptSrc).not.toContain("unsafe-eval");
      expect(scriptSrc).toContain("'self'");
    } finally { env.cleanup(); }
  });

  it("keeps the baseline directives and tightens object/base/frame", async () => {
    const env = setupEnv();
    try {
      const base = await spin(17961);
      const csp = (await fetch(`${base}/api/dashboard`)).headers.get("content-security-policy") ?? "";
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("img-src 'self' data:");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
    } finally { env.cleanup(); }
  });

  it("serves the sha256 hashes generated at build time", async () => {
    const hashFile = join(DIST_WEB, "csp-hashes.json");
    if (!existsSync(hashFile)) return; // unbuilt tree — covered by the build test below
    const { scriptSrc } = JSON.parse(readFileSync(hashFile, "utf8")) as { scriptSrc: string[] };
    const env = setupEnv();
    try {
      const base = await spin(17962);
      const csp = (await fetch(`${base}/api/dashboard`)).headers.get("content-security-policy") ?? "";
      expect(scriptSrc.length).toBeGreaterThan(0);
      for (const h of scriptSrc) expect(csp).toContain(`'${h}'`);
    } finally { env.cleanup(); }
  });
});

describe("Phase 1 — built artifact stays CSP-compatible", () => {
  const indexPath = join(DIST_WEB, "index.html");

  it("dist index.html has no inline event handlers", () => {
    if (!existsSync(indexPath)) return;
    const html = readFileSync(indexPath, "utf8");
    // onclick=, onerror=, onload= ... would each need 'unsafe-hashes'.
    expect(html.match(/\son[a-z]+\s*=\s*["']/gi)).toBeNull();
  });

  it("hash file matches the inline script actually in dist index.html", async () => {
    const hashFile = join(DIST_WEB, "csp-hashes.json");
    if (!existsSync(indexPath) || !existsSync(hashFile)) return;
    const { createHash } = await import("node:crypto");
    const html = readFileSync(indexPath, "utf8");
    const { scriptSrc } = JSON.parse(readFileSync(hashFile, "utf8")) as { scriptSrc: string[] };

    const recomputed: string[] = [];
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (m[1].trim() === "") continue;
      recomputed.push(`sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}`);
    }
    // Drift here means the served CSP would block the served page.
    expect(recomputed).toEqual(scriptSrc);
  });

  it("bundles DOMPurify into the vendor chunk", () => {
    const cm = join(DIST_WEB, "vendor", "cm.js");
    if (!existsSync(cm)) return;
    // Exported name survives minification because it is a named ESM export.
    expect(readFileSync(cm, "utf8")).toMatch(/DOMPurify/);
  });
});

describe("Phase 1 — DOMPurify neutralises hostile Markdown", () => {
  // Mirrors PURIFY_CFG in src/web/index.html. Kept in sync deliberately: this
  // is the contract the preview path relies on.
  const PURIFY_CFG = {
    ALLOWED_TAGS: [
      "h1","h2","h3","h4","h5","h6","p","br","hr","strong","b","em","i","del","s",
      "code","pre","blockquote","ul","ol","li","table","thead","tbody","tr","th","td",
      "a","img","details","summary",
    ],
    ALLOWED_ATTR: ["href","src","alt","title","class","id","align","width","height"],
    ALLOW_DATA_ATTR: false,
  };

  async function render(md: string): Promise<string> {
    const { marked } = await import("marked");
    const { JSDOM } = await import("jsdom");
    const createDOMPurify = (await import("dompurify")).default;
    const purify = createDOMPurify(new JSDOM("").window as unknown as Window & typeof globalThis);
    return purify.sanitize(await marked.parse(md), PURIFY_CFG);
  }

  it("strips <script> blocks", async () => {
    const out = await render(`ok\n\n<script>window.pwned=1</script>\n`);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain("window.pwned");
  });

  it("strips inline event handlers", async () => {
    const out = await render(`<img src=x onerror="window.pwned=1">\n`);
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toContain("window.pwned");
  });

  it("strips javascript: URLs in links", async () => {
    const out = await render(`[click](javascript:window.pwned=1)\n`);
    expect(out).not.toMatch(/javascript:/i);
  });

  it("strips iframes and data:text/html vectors", async () => {
    const out = await render(`<iframe src="data:text/html,<script>parent.pwned=1</script>"></iframe>\n`);
    expect(out).not.toMatch(/<iframe/i);
    expect(out).not.toMatch(/data:text\/html/i);
  });

  it("strips svg/foreignObject and on* inside them", async () => {
    const out = await render(`<svg><foreignObject><body onload="window.pwned=1"></body></foreignObject></svg>\n`);
    expect(out).not.toMatch(/<svg|<foreignobject|onload/i);
  });

  it("strips form/input exfiltration scaffolding", async () => {
    const out = await render(`<form action="http://evil.test"><input name="x"></form>\n`);
    expect(out).not.toMatch(/<form|<input/i);
  });

  it("drops data-* attributes", async () => {
    const out = await render(`<p data-evil="1">x</p>\n`);
    expect(out).not.toMatch(/data-evil/i);
  });

  it("preserves the formatting a Markdown preview legitimately needs", async () => {
    const out = await render(
      `# Title\n\n**bold** and *em* and \`code\`\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n` +
      "```js\nconst x = 1;\n```\n\n[link](https://example.test/page)\n\n> quote\n"
    );
    expect(out).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(out).toMatch(/<strong>bold<\/strong>/);
    expect(out).toMatch(/<em>em<\/em>/);
    expect(out).toMatch(/<code>/);
    expect(out).toMatch(/<li>one<\/li>/);
    expect(out).toMatch(/<table>[\s\S]*<td>1<\/td>/);
    expect(out).toMatch(/<blockquote>/);
    expect(out).toContain('href="https://example.test/page"');
    // marked emits class="language-js" on fenced blocks — class must survive.
    expect(out).toMatch(/class="language-js"/);
  });
});
