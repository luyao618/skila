/**
 * AC18 Visual Gate Screenshot Script
 * Captures 4 views of the skila web control panel for visual scoring.
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = "http://127.0.0.1:7777";
const TOKEN = "53181c9fbe6c4210759a200a08b130a033d84907bea094bd";
const OUT = "/Users/yao/work/code/personal/skila/.omc/screenshots/phase-3";

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: { "x-skila-token": TOKEN },
});
const page = await ctx.newPage();

// Inject token cookie too
await ctx.addCookies([{ name: "skila_token", value: TOKEN, domain: "127.0.0.1", path: "/" }]);

// 1. Dashboard
await page.goto(BASE, { waitUntil: "networkidle" });
await page.click("#tab-dashboard");
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "01-dashboard.png"), fullPage: false });
console.log("✓ 01-dashboard.png");

// 2. Skill list (Skills tab with all 4 skills visible)
await page.click("#tab-skills");
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, "02-skill-list.png"), fullPage: false });
console.log("✓ 02-skill-list.png");

// 3. Skill detail (select code-review, see editor)
await page.click('[data-name="code-review"]');
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "03-skill-detail.png"), fullPage: false });
console.log("✓ 03-skill-detail.png");

// 4. Diff view — click first version button to trigger diff
const versionBtns = page.locator("#versions-list button");
const count = await versionBtns.count();
console.log(`Versions available: ${count}`);
if (count > 0) {
  await versionBtns.first().click();
  await page.waitForTimeout(800);
}
await page.screenshot({ path: join(OUT, "04-diff-view.png"), fullPage: false });
console.log("✓ 04-diff-view.png");

await browser.close();
console.log("All screenshots saved to", OUT);
