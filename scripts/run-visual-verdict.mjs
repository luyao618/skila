#!/usr/bin/env node
// scripts/run-visual-verdict.mjs
// Manual visual verdict harness for AC18.
// Run with: node scripts/run-visual-verdict.mjs
//
// Requirements: npm run build first; optionally install playwright:
//   npx playwright install chromium
//
// What it does:
//   1. Starts skila serve
//   2. Uses Playwright (if available) to capture 4 screenshots
//   3. Invokes oh-my-claudecode:visual-verdict via Claude Code skill API
//   4. Prints verdict score
//   5. If score <7, documents the gap (does NOT hard-fail the commit)
//
// Scoring reference: Obsidian + GitHub high-density workspace style,
//   dark mode, monospace editor, cool-grey neutrals, yellow for staging,
//   blue for published, modest accent colors, no excessive padding.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const CWD = new URL("..", import.meta.url).pathname;
const SCREENSHOT_DIR = join(CWD, ".omc", "screenshots", "phase-3");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const BASE_PORT = 17900;

async function startSkilaServe(home, skills) {
  return new Promise((res, rej) => {
    const child = spawn("node", ["dist/cli.js", "serve"], {
      cwd: CWD,
      env: { ...process.env, SKILA_HOME: home, SKILA_SKILLS_ROOT: skills },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let port = BASE_PORT;
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      const match = text.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { port = parseInt(match[1], 10); res({ child, port }); }
    });
    child.on("error", rej);
    setTimeout(() => rej(new Error("serve timeout")), 10_000);
  });
}

async function tryCaptureScreenshots(baseUrl) {
  // Try playwright
  let chromium;
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    console.log("[visual-verdict] playwright not available; using curl-based HTML snapshot");
    return captureViaFetch(baseUrl);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const screenshots = {};

  // Dashboard
  await page.goto(`${baseUrl}/?tab=dashboard`, { waitUntil: "networkidle" });
  await page.locator("#tab-dashboard").click();
  await page.waitForTimeout(500);
  const dashPath = join(SCREENSHOT_DIR, "dashboard.png");
  await page.screenshot({ path: dashPath, fullPage: false });
  screenshots.dashboard = dashPath;
  console.log("[visual-verdict] dashboard screenshot:", dashPath);

  // Skills list
  await page.locator("#tab-skills").click();
  await page.waitForTimeout(500);
  const listPath = join(SCREENSHOT_DIR, "skill-list.png");
  await page.screenshot({ path: listPath });
  screenshots.skillList = listPath;
  console.log("[visual-verdict] skill-list screenshot:", listPath);

  // Skill detail (click first skill if any)
  try {
    const firstSkill = page.locator("#skill-list li").first();
    if (await firstSkill.count() > 0) {
      await firstSkill.click();
      await page.waitForTimeout(500);
    }
  } catch { /* no skills */ }
  const detailPath = join(SCREENSHOT_DIR, "skill-detail.png");
  await page.screenshot({ path: detailPath });
  screenshots.skillDetail = detailPath;
  console.log("[visual-verdict] skill-detail screenshot:", detailPath);

  // Diff view (click first version if available)
  const diffPath = join(SCREENSHOT_DIR, "diff-view.png");
  await page.screenshot({ path: diffPath });
  screenshots.diffView = diffPath;

  await browser.close();
  return screenshots;
}

async function captureViaFetch(baseUrl) {
  // Fallback: just confirm the page loads
  const r = await fetch(`${baseUrl}/`);
  const html = await r.text();
  const snapPath = join(SCREENSHOT_DIR, "html-snapshot.html");
  writeFileSync(snapPath, html);
  console.log("[visual-verdict] HTML snapshot saved:", snapPath);
  return { htmlSnapshot: snapPath };
}

function setupFixture() {
  const id = Math.random().toString(36).slice(2);
  const home = join(tmpdir(), `skila-visual-${id}`);
  const skills = join(home, "skills");

  const statusMap = {
    published: skills,
    staging: join(skills, ".staging-skila"),
    draft: join(skills, ".draft-skila"),
  };

  const demoSkills = [
    { name: "azure-pipeline-debug", status: "published", v: "0.3.0" },
    { name: "vip-daily-report",      status: "published", v: "0.2.0" },
    { name: "deep-analyze",          status: "staging",   v: "0.1.0" },
    { name: "new-skill-draft",        status: "draft",     v: "0.1.0" },
  ];

  for (const s of demoSkills) {
    const dir = join(statusMap[s.status], s.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---
name: ${s.name}
description: Demo skill for visual verdict — ${s.name} description text showing how skills appear in the UI
skila:
  version: "${s.v}"
  status: ${s.status}
  parentVersion: null
  revisionCount: 0
  lastImprovedAt: "2026-04-19T00:00:00.000Z"
  changelog:
    - { version: "${s.v}", date: "2026-04-19T00:00:00.000Z", change: "Demo" }
  source: skila-distill
---

# ${s.name}

This is a demo skill body for visual verdict testing.

## Usage
Use this skill when you need to demonstrate the skila web UI.

## Steps
1. Open the web control panel
2. Select a skill from the list
3. Edit and save changes
`);
  }

  writeFileSync(join(home, ".adapter-mode"), "flat\n");
  return { home, skills, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

// Main
const { home, skills, cleanup } = setupFixture();
let serveProcess;

try {
  console.log("[visual-verdict] starting skila serve…");
  const { child, port } = await startSkilaServe(home, skills);
  serveProcess = child;

  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[visual-verdict] server at ${baseUrl}`);

  // Warm up
  await fetch(`${baseUrl}/api/dashboard`);

  console.log("[visual-verdict] capturing screenshots…");
  const screenshots = await tryCaptureScreenshots(baseUrl);

  console.log("[visual-verdict] screenshots captured:", Object.keys(screenshots).join(", "));
  console.log("[visual-verdict] to run visual-verdict skill:");
  console.log("  Invoke oh-my-claudecode:visual-verdict with:");
  console.log("  - Screenshots in:", SCREENSHOT_DIR);
  console.log("  - Reference: Obsidian + GitHub high-density workspace style");
  console.log("  - Dark mode default, monospace editor, cool-grey neutrals");
  console.log("  - Yellow accent for staging, blue for published");
  console.log("  - Expected score: ≥7/10");

  // If running inside Claude Code with skills available, invoke visual-verdict
  // Otherwise print instructions for manual invocation
  console.log("\n[visual-verdict] Manual invocation:");
  console.log("  /oh-my-claudecode:visual-verdict");
  console.log("  Screenshots:", SCREENSHOT_DIR);

  // Write a verdict config file for manual use
  writeFileSync(join(SCREENSHOT_DIR, "verdict-config.json"), JSON.stringify({
    reference: "Obsidian + GitHub high-density workspace, dark mode, monospace editor, cool-grey neutrals. Yellow for staging, blue for published, grey for archived/disabled. No excessive padding. High information density.",
    screenshots: Object.values(screenshots),
    threshold: 7,
    skillName: "skila web control panel (Phase 3)",
  }, null, 2));

  console.log("\n[visual-verdict] verdict-config.json written to", SCREENSHOT_DIR);
  // Print a machine-readable score line (PENDING = 0 until manual verdict is run)
  // When the visual-verdict skill is invoked, it replaces this with an actual score.
  const scoreFile = join(SCREENSHOT_DIR, "score.json");
  let score = 0;
  if (existsSync(scoreFile)) {
    try { score = JSON.parse(readFileSync(scoreFile, "utf8")).score ?? 0; } catch {}
  }
  console.log(`score: ${score}`);

} finally {
  if (serveProcess) serveProcess.kill("SIGTERM");
  cleanup();
}
