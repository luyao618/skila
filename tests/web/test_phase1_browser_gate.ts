// tests/web/test_phase1_browser_gate.ts
// Production-path XSS/CSP regression in a REAL browser.
//
// Why this exists as a separate, browser-backed suite: the jsdom tests in
// test_phase1_xss_csp.ts extract PURIFY_CFG from index.html and re-run the
// pipeline themselves. That catches an allowlist that is loosened in source,
// but it still is not `safeMarkdown()` executing on the page. Only a real
// browser can show that:
//   - the sha256 CSP actually authorises the inline module (the app boots),
//   - both innerHTML sinks strip hostile markup as they run in production,
//   - the payload never executes,
//   - and no CSP violation or page error is raised while doing it.
//
// Requires Chromium. Runs unconditionally when SKILA_BROWSER_GATE=1 (CI sets
// it); otherwise auto-detects an installed browser and skips with a clear
// reason rather than passing silently.

import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, cpSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { startServer } from "../../src/web/server.js";
import { resetAdapterCacheForTests } from "../../src/storage/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST_WEB = join(ROOT, "dist", "web");

const REQUIRED = process.env.SKILA_BROWSER_GATE === "1";

/** Chromium present? When the gate is required we never silently skip. */
async function chromiumAvailable(): Promise<boolean> {
  if (!existsSync(join(DIST_WEB, "index.html"))) return false;
  try {
    const { chromium } = await import("playwright");
    const b = await chromium.launch({ headless: true });
    await b.close();
    return true;
  } catch {
    return false;
  }
}

let ENABLED = false;
beforeAll(async () => {
  ENABLED = await chromiumAvailable();
  if (REQUIRED && !ENABLED) {
    throw new Error(
      "SKILA_BROWSER_GATE=1 but Chromium/dist is unavailable. " +
      "Run `npm run build && npx playwright install chromium`."
    );
  }
  if (!ENABLED) {
    console.warn("[browser-gate] skipped: no Chromium or unbuilt dist. Set SKILA_BROWSER_GATE=1 to enforce.");
  }
});

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of closers) { try { await c(); } catch {} }
  closers.length = 0;
  resetAdapterCacheForTests();
  delete process.env.SKILA_HOME;
  delete process.env.SKILA_SKILLS_ROOT;
});

/**
 * Hostile SKILL.md served through the real API. Each vector targets a
 * different sanitizer responsibility; all must be neutralised while the
 * legitimate Markdown around them still renders.
 */
const HOSTILE_BODY = [
  "# heading survives",
  "",
  `<img src=x onerror="window.__XSS_IMG = 1">`,
  "",
  `<script>window.__XSS_SCRIPT = 1;</script>`,
  "",
  `<a id="js-link" href="javascript:window.__XSS_HREF=1">js link</a>`,
  "",
  `<iframe id="f" src="data:text/html,<script>parent.__XSS_FRAME=1</script>"></iframe>`,
  "",
  `<svg><foreignObject><body onload="window.__XSS_SVG=1"></body></foreignObject></svg>`,
  "",
  `<details open ontoggle="window.__XSS_TOGGLE=1">d</details>`,
  "",
  `<p style="background:url(http://evil.test/leak)">styled</p>`,
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "```js",
  "const ok = 1;",
  "```",
].join("\n");

function makeSkill(name: string, body: string) {
  const now = new Date().toISOString();
  return `---
name: ${name}
description: browser gate fixture
skila:
  version: "0.1.0"
  status: published
  parentVersion: null
  revisionCount: 0
  lastImprovedAt: "${now}"
  changelog:
    - { version: "0.1.0", date: "${now}", change: "Initial" }
  source: skila-distill
---

${body}
`;
}

function setupEnv(body: string) {
  const id = Math.random().toString(36).slice(2);
  const home = join(tmpdir(), `skila-browser-gate-${id}`);
  const skills = join(home, "skills");
  const dir = join(skills, "gate-probe");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(home, ".adapter-mode"), "flat\n");
  writeFileSync(join(dir, "SKILL.md"), makeSkill("gate-probe", body));
  process.env.SKILA_HOME = home;
  process.env.SKILA_SKILLS_ROOT = skills;
  resetAdapterCacheForTests();
  return { home, cleanup: () => { if (existsSync(home)) rmSync(home, { recursive: true, force: true }); } };
}

interface Session {
  page: import("playwright").Page;
  problems: string[];
  csp: string;
  close: () => Promise<void>;
}

/** Boot the real server against the real dist/ and open the page. */
async function openApp(port: number, distDir?: string): Promise<Session> {
  const { port: p, close } = await startServer(distDir ? { port, distDir } : { port });
  closers.push(close);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const problems: string[] = [];
  page.on("console", m => {
    const t = m.text();
    if (/Content Security Policy|Refused to/i.test(t)) problems.push(`csp: ${t}`);
  });
  page.on("pageerror", e => problems.push(`pageerror: ${e.message}`));

  const resp = await page.goto(`http://127.0.0.1:${p}/`, { waitUntil: "networkidle" });
  const csp = resp?.headers()["content-security-policy"] ?? "";

  return {
    page, problems, csp,
    close: async () => { await browser.close(); },
  };
}

/** Assert the live DOM inside #preview-rendered carries nothing executable. */
async function auditPreviewDom(page: import("playwright").Page) {
  return page.evaluate(() => {
    const el = document.getElementById("preview-rendered");
    if (!el) return { found: false } as Record<string, unknown>;
    const offenders: string[] = [];
    for (const node of Array.from(el.querySelectorAll("*"))) {
      for (const attr of node.getAttributeNames()) {
        const val = node.getAttribute(attr) ?? "";
        if (attr.toLowerCase().startsWith("on")) offenders.push(`${node.tagName}[${attr}]`);
        if (attr.toLowerCase() === "style") offenders.push(`${node.tagName}[style]`);
        if (/^\s*(javascript|data:text\/html)/i.test(val)) offenders.push(`${node.tagName}[${attr}]=${val.slice(0, 40)}`);
      }
    }
    const w = window as unknown as Record<string, unknown>;
    return {
      found: true,
      offenders,
      hasScript: !!el.querySelector("script"),
      hasIframe: !!el.querySelector("iframe"),
      hasSvg: !!el.querySelector("svg"),
      headingRendered: !!el.querySelector("h1"),
      tableRendered: !!el.querySelector("table td"),
      imgAttrs: Array.from(el.querySelectorAll("img")).map(i => i.getAttributeNames()),
      firedFlags: ["__XSS_IMG","__XSS_SCRIPT","__XSS_HREF","__XSS_FRAME","__XSS_SVG","__XSS_TOGGLE","__XSS_LIVE"]
        .filter(k => !!w[k]),
      html: el.innerHTML.slice(0, 400),
    } as Record<string, unknown>;
  });
}

/** Select the fixture skill and switch to the Preview tab (sink #1). */
async function openPreview(page: import("playwright").Page) {
  await page.click("#skill-list li[data-name]");
  await page.waitForSelector("#editor .cm-content", { timeout: 10_000 });
  await page.click("#view-preview");
  await page.waitForFunction(
    () => (document.getElementById("preview-rendered")?.innerHTML.length ?? 0) > 0,
    undefined,
    { timeout: 10_000 }
  );
}

describe("Phase 1 browser gate — real Chromium, real server, built dist/", () => {
  it("boots under the sha256 CSP with no violations", async () => {
    if (!ENABLED) return;
    const env = setupEnv("# plain\n\ncontent\n");
    const s = await openApp(18810);
    try {
      // The app is one inline module. If the hash did not authorise it, the
      // skill list never renders — this is the artifact-hash check end to end.
      expect(s.csp).toContain("script-src 'self' 'sha256-");
      expect(s.csp.split(";").find(d => d.trim().startsWith("script-src"))).not.toContain("unsafe");
      const booted = await s.page.evaluate(
        () => (document.getElementById("skill-list")?.children.length ?? 0) > 0
      );
      expect(booted, "inline module was blocked — CSP hash does not match the served page").toBe(true);
      expect(s.problems).toEqual([]);
    } finally { await s.close(); env.cleanup(); }
  }, 60_000);

  it("sink #1 (preview tab): strips hostile markup, payload never executes", async () => {
    if (!ENABLED) return;
    const env = setupEnv(HOSTILE_BODY);
    const s = await openApp(18811);
    try {
      await openPreview(s.page);
      const dom = await auditPreviewDom(s.page) as Record<string, any>;

      expect(dom.found).toBe(true);
      expect(dom.offenders, `executable attributes survived: ${JSON.stringify(dom.offenders)}`).toEqual([]);
      expect(dom.hasScript).toBe(false);
      expect(dom.hasIframe).toBe(false);
      expect(dom.hasSvg).toBe(false);
      // The payloads must not have run.
      expect(dom.firedFlags, `XSS executed: ${JSON.stringify(dom.firedFlags)}`).toEqual([]);
      // ...and legitimate content must still render.
      expect(dom.headingRendered).toBe(true);
      expect(dom.tableRendered).toBe(true);
      expect(dom.imgAttrs).toEqual([["src"]]);   // onerror gone, src kept
      expect(s.problems).toEqual([]);
    } finally { await s.close(); env.cleanup(); }
  }, 60_000);

  it("sink #2 (live update while typing): strips hostile markup, payload never executes", async () => {
    if (!ENABLED) return;
    const env = setupEnv("# clean start\n\nbody\n");
    const s = await openApp(18812);
    try {
      await openPreview(s.page);

      // Type into CodeMirror with the preview open: this is the real user path
      // through the updateListener sink, not a synthetic call.
      await s.page.click("#editor .cm-content");
      await s.page.keyboard.press("End");
      await s.page.keyboard.type(`\n\n<img src=y onerror="window.__XSS_LIVE=1">\n`, { delay: 5 });
      await s.page.waitForFunction(
        () => (document.getElementById("preview-rendered")?.querySelectorAll("img").length ?? 0) > 0,
        undefined,
        { timeout: 10_000 }
      );

      const dom = await auditPreviewDom(s.page) as Record<string, any>;
      expect(dom.offenders, `live-update kept executable attributes: ${JSON.stringify(dom.offenders)}`).toEqual([]);
      expect(dom.firedFlags, `live-update XSS executed: ${JSON.stringify(dom.firedFlags)}`).toEqual([]);
      expect(dom.hasScript).toBe(false);
      // Proves the typed markup actually reached this sink.
      expect(dom.imgAttrs.length).toBeGreaterThan(0);
      expect(dom.imgAttrs.every((a: string[]) => !a.some(n => n.startsWith("on")))).toBe(true);
      expect(s.problems).toEqual([]);
    } finally { await s.close(); env.cleanup(); }
  }, 60_000);

  it("missing manifest: CSP stays safe and the app does NOT boot", async () => {
    if (!ENABLED) return;
    // Copy the built dist and delete only the manifest, so this exercises the
    // real fail-closed path rather than a hand-made directory.
    const stage = join(tmpdir(), `skila-gate-nomanifest-${Math.random().toString(36).slice(2)}`);
    cpSync(DIST_WEB, stage, { recursive: true });
    const manifest = join(stage, "csp-hashes.json");
    if (existsSync(manifest)) unlinkSync(manifest);

    const env = setupEnv("# plain\n\ncontent\n");
    const s = await openApp(18813, stage);
    try {
      const scriptSrc = s.csp.split(";").map(d => d.trim()).find(d => d.startsWith("script-src")) ?? "";
      // Fail closed: no hash, and above all no unsafe-* fallback.
      expect(scriptSrc).toBe("script-src 'self'");
      expect(scriptSrc).not.toContain("unsafe");

      // With the inline module unauthorised the app must be inert, not degraded
      // into running without a policy.
      const booted = await s.page.evaluate(
        () => (document.getElementById("skill-list")?.children.length ?? 0) > 0
      );
      expect(booted, "app booted despite an unauthorised inline script").toBe(false);

      // The browser should have complained — that is the intended loud failure.
      expect(s.problems.length).toBeGreaterThan(0);
    } finally {
      await s.close(); env.cleanup();
      rmSync(stage, { recursive: true, force: true });
    }
  }, 60_000);
});
