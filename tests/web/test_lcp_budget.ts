// tests/web/test_lcp_budget.ts
// AC18b: Cold ≤800ms, warm ≤250ms LCP budget via real Playwright measurement.
//
// SKILA_VISUAL=1 required for real Playwright LCP tests.
// Without it, those tests are skipped (it.skip) — NOT a silent pass.
//
// Non-visual tests (proxy + vendor size) run in all environments.

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../../src/web/server.js";
import { resetAdapterCacheForTests } from "../../src/storage/index.js";

const VISUAL_ENABLED = process.env.SKILA_VISUAL === "1";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of closers) { try { await c(); } catch { } }
  closers.length = 0;
  resetAdapterCacheForTests();
  delete process.env.SKILA_HOME;
  delete process.env.SKILA_SKILLS_ROOT;
});

function setup() {
  const id = Math.random().toString(36).slice(2);
  const home = join(tmpdir(), `skila-lcp-test-${id}`);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, ".adapter-mode"), "flat\n");
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

describe("AC18b — LCP budget via real Playwright (SKILA_VISUAL=1 required)", () => {
  it.skipIf(!VISUAL_ENABLED)("cold LCP ≤800ms via page.evaluate PerformanceObserver (real browser)", async () => {

    const { home, cleanup } = setup();
    process.env.SKILA_HOME = home;
    process.env.SKILA_SKILLS_ROOT = join(home, "skills");
    resetAdapterCacheForTests();
    const { port, close } = await startServer({ port: 17840 });
    closers.push(close);

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Use PerformanceObserver to capture LCP
    const lcpPromise = page.evaluate(() => {
      return new Promise<number>((resolve) => {
        let lastLcp = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            lastLcp = entry.startTime;
          }
        });
        observer.observe({ type: "largest-contentful-paint", buffered: true });
        // Give it time to settle after page load
        window.addEventListener("load", () => {
          setTimeout(() => {
            observer.disconnect();
            resolve(lastLcp);
          }, 500);
        });
      });
    });

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    const lcp = await lcpPromise;

    await browser.close();
    cleanup();

    // Cold budget: ≤800ms
    expect(lcp).toBeLessThan(800);
  });

  it.skipIf(!VISUAL_ENABLED)("warm LCP ≤250ms via page.evaluate PerformanceObserver (real browser)", async () => {
    // Real Playwright LCP test — skipped when SKILA_VISUAL is not set.

    const { home, cleanup } = setup();
    process.env.SKILA_HOME = home;
    process.env.SKILA_SKILLS_ROOT = join(home, "skills");
    resetAdapterCacheForTests();
    const { port, close } = await startServer({ port: 17841 });
    closers.push(close);

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    // First visit (warm up browser caches)
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    await p1.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await ctx1.close();

    // Second visit (warm — assets cached in browser)
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    const lcpPromise = p2.evaluate(() => {
      return new Promise<number>((resolve) => {
        let lastLcp = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            lastLcp = entry.startTime;
          }
        });
        observer.observe({ type: "largest-contentful-paint", buffered: true });
        window.addEventListener("load", () => {
          setTimeout(() => {
            observer.disconnect();
            resolve(lastLcp);
          }, 300);
        });
      });
    });

    await p2.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    const lcp = await lcpPromise;

    await browser.close();
    cleanup();

    // Warm budget: ≤250ms
    expect(lcp).toBeLessThan(250);
  });
});

describe("AC18b — LCP budget (proxy: server assembly time)", () => {
  it("cold load: HTML + vendor reads complete within 500ms (loopback proxy)", async () => {
    const { home, cleanup } = setup();
    process.env.SKILA_HOME = home;
    process.env.SKILA_SKILLS_ROOT = join(home, "skills");
    resetAdapterCacheForTests();
    const { port, close } = await startServer({ port: 17830 });
    closers.push(close);

    // Warm up the server (connection overhead is not LCP)
    await fetch(`http://127.0.0.1:${port}/api/dashboard`);

    const t0 = performance.now();

    // 1. Fetch HTML
    const htmlR = await fetch(`http://127.0.0.1:${port}/`);
    await htmlR.text();

    // 2. Fetch vendor assets (simulates browser fetching them after parsing HTML)
    const cmR = await fetch(`http://127.0.0.1:${port}/vendor/cm.js`);
    await cmR.arrayBuffer(); // drain
    const cssR = await fetch(`http://127.0.0.1:${port}/vendor/tw.css`);
    await cssR.arrayBuffer();

    const t1 = performance.now();
    const elapsed = t1 - t0;

    // Cold budget: ≤500ms
    expect(elapsed).toBeLessThan(500);
    cleanup();
  });

  it("warm load: HTML response time (assets cached) within 200ms", async () => {
    const { home, cleanup } = setup();
    process.env.SKILA_HOME = home;
    process.env.SKILA_SKILLS_ROOT = join(home, "skills");
    resetAdapterCacheForTests();
    const { port, close } = await startServer({ port: 17831 });
    closers.push(close);

    // Warm: pre-load assets to OS page cache equivalent (fetch + discard)
    await fetch(`http://127.0.0.1:${port}/vendor/cm.js`).then(r => r.arrayBuffer());
    await fetch(`http://127.0.0.1:${port}/vendor/tw.css`).then(r => r.arrayBuffer());
    await fetch(`http://127.0.0.1:${port}/`).then(r => r.text());

    // Now measure warm HTML-only
    const t0 = performance.now();
    const r = await fetch(`http://127.0.0.1:${port}/`);
    await r.text();
    const t1 = performance.now();
    const elapsed = t1 - t0;

    // Warm budget: ≤200ms
    expect(elapsed).toBeLessThan(200);
    cleanup();
  });

  it("vendor file sizes are within acceptable LCP budget constraints", () => {
    // Validates that vendor assets are within size bounds that allow ≤500ms LCP
    // on loopback. At loopback (~1GB/s) 500KB = ~0.5ms transfer; parse dominates.
    const cwd = process.cwd();
    const cmPath = join(cwd, "dist", "web", "vendor", "cm.js");
    const cssPath = join(cwd, "dist", "web", "vendor", "tw.css");

    const cmSize = statSync(cmPath).size;
    const cssSize = statSync(cssPath).size;

    // cm.js: expect < 600KB (esbuild minified bundle)
    expect(cmSize).toBeLessThan(600 * 1024);
    // tw.css: expect < 100KB (purged Tailwind)
    expect(cssSize).toBeLessThan(100 * 1024);
  });
});
