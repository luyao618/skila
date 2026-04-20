#!/usr/bin/env node
// skila feedback hook bridge (CommonJS for plugin.json compatibility).
// Phase 2: parses {event, tool, result, session?, skill?} from stdin,
// calls collectFeedback() via the dist/cli.js bridge, exits ≤1s.

"use strict";

const path = require("path");

const CLI_PATH = path.resolve(__dirname, "..", "cli.js");

// Hard time budget. Per AC9 the budget is ≤1000ms end-to-end.
const HARD_BUDGET_MS = 1000;
const watchdog = setTimeout(() => process.exit(0), HARD_BUDGET_MS);
watchdog.unref();

let buf = "";
process.stdin.setEncoding("utf8");

function finalize() {
  clearTimeout(watchdog);
  let payload = {};
  try { payload = buf.trim() ? JSON.parse(buf) : {}; } catch { /* ignore */ }
  // Dynamic import the ESM bridge.
  import(require("url").pathToFileURL(CLI_PATH).href)
    .then((mod) => {
      try { mod.collectFeedback(payload); } catch { /* swallow */ }
      process.exit(0);
    })
    .catch(() => process.exit(0));
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
