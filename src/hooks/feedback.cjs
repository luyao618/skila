#!/usr/bin/env node
// skila feedback hook bridge (CommonJS for plugin.json compatibility).
// FIX-H23: imports dist/hooks/feedback-entry.cjs (esbuild CommonJS bundle,
// tree-shaken, <100KB) instead of dynamic-importing the full cli.js ESM.
// This eliminates the dynamic import overhead and keeps hook latency ≤50ms median.

"use strict";

const path = require("path");

// FIX-H23: Use pre-bundled CJS entry instead of full cli.js ESM dynamic import.
const ENTRY_PATH = path.resolve(__dirname, "..", "hooks", "feedback-entry.cjs");

// Hard time budget ≤1000ms end-to-end.
const HARD_BUDGET_MS = 1000;

let buf = "";
process.stdin.setEncoding("utf8");

function finalize() {
  let payload = {};
  try { payload = buf.trim() ? JSON.parse(buf) : {}; } catch { /* ignore */ }

  const watchdog = setTimeout(() => process.exit(0), HARD_BUDGET_MS);
  watchdog.unref();

  let mod;
  try {
    mod = require(ENTRY_PATH);
  } catch {
    clearTimeout(watchdog);
    process.exit(0);
  }

  Promise.resolve()
    .then(async () => {
      try {
        if (typeof mod.collectFromHookPayload === "function") {
          mod.collectFromHookPayload(payload);
        } else if (typeof mod.collectFeedback === "function") {
          mod.collectFeedback(payload);
        }
        if (typeof mod.drainFeedback === "function") {
          await mod.drainFeedback();
        }
      } catch { /* swallow */ }
      clearTimeout(watchdog);
      process.exit(0);
    })
    .catch(() => {
      clearTimeout(watchdog);
      process.exit(0);
    });
}

if (process.stdin.isTTY) {
  finalize();
} else {
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    if (buf.length > 1024 * 64) buf = buf.slice(0, 1024 * 64);
  });
  process.stdin.on("end", finalize);
  process.stdin.on("error", finalize);
}
