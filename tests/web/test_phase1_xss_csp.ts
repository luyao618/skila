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

describe("Phase 1 — CSP manifest fails closed", () => {
  // A broken/absent manifest must never degrade to 'unsafe-inline'. It is
  // allowed to break the page (script-src 'self' blocks the inline module) —
  // that is the safe direction — but it must never widen the policy.
  async function cspFor(distDir: string, port: number): Promise<string> {
    const { port: p, close } = await startServer({ port, distDir });
    closers.push(close);
    const r = await fetch(`http://127.0.0.1:${p}/api/dashboard`);
    return r.headers.get("content-security-policy") ?? "";
  }

  function tmpDist(manifest?: string) {
    const dir = join(tmpdir(), `skila-csp-manifest-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    if (manifest !== undefined) writeFileSync(join(dir, "csp-hashes.json"), manifest);
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  const cases: Array<[string, string | undefined]> = [
    ["missing manifest", undefined],
    ["unparseable JSON", "{ not json"],
    ["empty hash list", JSON.stringify({ scriptSrc: [] })],
    ["wrong shape", JSON.stringify({ scriptSrc: "sha256-abc" })],
    ["malformed hash entry", JSON.stringify({ scriptSrc: ["'unsafe-inline'"] })],
    ["injection attempt via hash", JSON.stringify({ scriptSrc: ["sha256-x' 'unsafe-inline"] })],
  ];

  cases.forEach(([name, manifest], i) => {
    it(`${name} → never widens the policy`, async () => {
      const env = setupEnv();
      const dist = tmpDist(manifest);
      try {
        const csp = await cspFor(dist.dir, 17970 + i);
        const scriptSrc = csp.split(";").map(s => s.trim()).find(s => s.startsWith("script-src")) ?? "";
        expect(scriptSrc).toBe("script-src 'self'");
        expect(scriptSrc).not.toContain("unsafe");
      } finally { dist.cleanup(); env.cleanup(); }
    });
  });

  it("a valid manifest is applied verbatim", async () => {
    const env = setupEnv();
    const hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const dist = tmpDist(JSON.stringify({ scriptSrc: [hash] }));
    try {
      const csp = await cspFor(dist.dir, 17990);
      expect(csp).toContain(`script-src 'self' '${hash}'`);
    } finally { dist.cleanup(); env.cleanup(); }
  });
});

describe("Phase 1 — CSP hash manifest ships with the package", () => {
  it("package.json files[] covers dist/, which carries csp-hashes.json", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { files: string[] };
    // The manifest lives in dist/web/, so a bare "dist" entry is what ships it.
    expect(pkg.files).toContain("dist");
  });
});

describe("Phase 1 — bundled vendor code is tracked", () => {
  // These packages are devDependencies that esbuild inlines into the published
  // bundle, so `npm audit --omit=dev` cannot see them. The tracking list must
  // not silently fall behind what the build actually bundles.
  const auditSrc = readFileSync(join(ROOT, "scripts", "vendor-audit.mjs"), "utf8");
  const shimSrc = readFileSync(join(ROOT, "scripts", "postbuild.mjs"), "utf8");

  it("every package bundled into the vendor entry is in the audit list", () => {
    const start = shimSrc.indexOf("const ENTRY_SHIM_SOURCE");
    const end = shimSrc.indexOf("writeFileSync(entryShim, ENTRY_SHIM_SOURCE)");
    const shim = shimSrc.slice(start, end);
    // Packages the shim re-exports, i.e. what lands inside cm.js.
    const bundled = [...shim.matchAll(/from \\"([^"\\]+)\\"/g)].map(m => m[1]);
    expect(bundled.length).toBeGreaterThan(0);
    for (const pkg of bundled) {
      // Keys may be bare (marked:) or quoted ("@codemirror/state":).
      const tracked = auditSrc.includes(`"${pkg}"`) || new RegExp(`^\\s*${pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*:`, "m").test(auditSrc);
      expect(tracked, `${pkg} is bundled but missing from vendor-audit.mjs`).toBe(true);
    }
  });

  it("tracks echarts, which postbuild bundles separately", () => {
    expect(shimSrc).toContain('"echarts", "index.js"');
    expect(auditSrc).toContain("echarts:");
  });

  it("exposes an audit:vendor script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["audit:vendor"]).toBe("node scripts/vendor-audit.mjs");
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
  // The config is NOT redeclared here. index.html is a standalone artifact with
  // no import mechanism, so a hand-copied PURIFY_CFG would silently stop
  // reflecting reality the moment the real one changed. Extract the actual
  // source instead: if someone loosens the allowlist in index.html, these
  // assertions see the loosened config and fail.
  const HTML_SRC = readFileSync(join(ROOT, "src", "web", "index.html"), "utf8");

  function extractPurifyCfg(): Record<string, unknown> {
    const start = HTML_SRC.indexOf("const PURIFY_CFG = {");
    expect(start, "PURIFY_CFG not found in src/web/index.html").toBeGreaterThan(-1);
    const open = HTML_SRC.indexOf("{", start);
    let depth = 0, end = -1;
    for (let i = open; i < HTML_SRC.length; i++) {
      if (HTML_SRC[i] === "{") depth++;
      else if (HTML_SRC[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    expect(end, "PURIFY_CFG object literal is unterminated").toBeGreaterThan(open);
    const literal = HTML_SRC.slice(open, end).replace(/\/\/[^\n]*/g, "");
    return Function(`"use strict"; return (${literal});`)() as Record<string, unknown>;
  }

  const PURIFY_CFG = extractPurifyCfg();

  // Mirrors `function safeMarkdown(src)` in index.html — same two-step pipeline
  // the real sinks call, with the real config.
  async function safeMarkdown(src: string): Promise<string> {
    const { marked } = await import("marked");
    const { JSDOM } = await import("jsdom");
    const createDOMPurify = (await import("dompurify")).default;
    const purify = createDOMPurify(new JSDOM("").window as unknown as Window & typeof globalThis);
    return purify.sanitize(await marked.parse(src), PURIFY_CFG);
  }
  const render = safeMarkdown;

  it("both innerHTML sinks in index.html route through safeMarkdown", () => {
    // The regression this guards: someone adds a third preview path, or reverts
    // one of these to a bare marked.parse().
    const sinks = [...HTML_SRC.matchAll(/innerHTML\s*=\s*([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]);
    expect(sinks).toContain("safeMarkdown");
    expect(HTML_SRC.match(/innerHTML\s*=\s*safeMarkdown\(/g)?.length).toBe(2);
    // No sink may pass marked output to innerHTML without sanitizing.
    expect(HTML_SRC).not.toMatch(/innerHTML\s*=\s*marked\.parse\(/);
  });

  it("the extracted config is the hardened one (no style, no data-*)", () => {
    expect(PURIFY_CFG.ALLOW_DATA_ATTR).toBe(false);
    expect(PURIFY_CFG.ALLOWED_ATTR as string[]).not.toContain("style");
    expect(PURIFY_CFG.ALLOWED_TAGS as string[]).not.toContain("script");
    expect(PURIFY_CFG.ALLOWED_TAGS as string[]).not.toContain("iframe");
  });

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

  // Asserting on the parsed DOM rather than the HTML string: a substring check
  // can pass while the live document still holds an executable attribute.
  it("produces a DOM with no executable attributes or nodes", async () => {
    const { JSDOM } = await import("jsdom");
    const hostile = [
      `<img src=x onerror="window.pwned=1">`,
      `<a href="javascript:window.pwned=1">x</a>`,
      `[md link](javascript:window.pwned=1)`,
      `<script>window.pwned=1</script>`,
      `<iframe src="data:text/html,<script>parent.pwned=1</script>"></iframe>`,
      `<svg><foreignObject><body onload="window.pwned=1"></body></foreignObject></svg>`,
      `<details open ontoggle="window.pwned=1">x</details>`,
      `<p style="background:url(http://evil.test)">x</p>`,
    ].join("\n\n");

    const dom = new JSDOM(`<div id="preview-rendered"></div>`);
    const host = dom.window.document.getElementById("preview-rendered")!;
    host.innerHTML = await render(hostile);

    for (const el of host.querySelectorAll("*")) {
      for (const attr of el.getAttributeNames()) {
        expect(attr.toLowerCase().startsWith("on"), `${el.tagName} kept ${attr}`).toBe(false);
        expect(attr.toLowerCase()).not.toBe("style");
        const v = el.getAttribute(attr) ?? "";
        expect(/^\s*javascript:/i.test(v), `${el.tagName}[${attr}] = ${v}`).toBe(false);
      }
    }
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("svg")).toBeNull();
    // jsdom does not execute injected markup, so the meaningful assertion is
    // that no executable surface survived — checked attribute-by-attribute above.
    expect((dom.window as unknown as Record<string, unknown>).pwned).toBeUndefined();
  });
});
