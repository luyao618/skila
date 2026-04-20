#!/usr/bin/env node
// skila feedback hook bridge (CommonJS for plugin.json compatibility).
// Phase 2: parses {event, tool, result, session?, skill?} from stdin,
// calls collectFeedback() via the dist/cli.js bridge, exits ≤1s.
//
// FIX-C9: watchdog cleared BEFORE dynamic import; drainFeedback() awaited
// before process.exit so records are not lost on fast exit.

"use strict";

const path = require("path");

const CLI_PATH = path.resolve(__dirname, "..", "cli.js");

// Hard time budget. Per AC9 the budget is ≤1000ms end-to-end.
const HARD_BUDGET_MS = 1000;

let buf = "";
process.stdin.setEncoding("utf8");

function finalize() {
  let payload = {};
  try { payload = buf.trim() ? JSON.parse(buf) : {}; } catch { /* ignore */ }

  // FIX-C9: clear watchdog BEFORE dynamic import begins (not after).
  const watchdog = setTimeout(() => process.exit(0), HARD_BUDGET_MS);
  watchdog.unref();
  clearTimeout(watchdog);

  // Dynamic import the ESM bridge.
  // FIX-M21: route through collectFromHookPayload so the redaction allowlist
  // is the only path raw harness payloads can take to reach feedback.json.
  // FIX-C9: skill extraction (tool_input.skill_name / .skill / path heuristic)
  // happens inside collectFromHookPayload → sanitizeRawPayload in collector.ts.
  import(require("url").pathToFileURL(CLI_PATH).href)
    .then(async (mod) => {
      try {
        if (typeof mod.collectFromHookPayload === "function") {
          mod.collectFromHookPayload(payload);
        } else {
          mod.collectFeedback(payload);
        }
        // FIX-C9: await drain before exit so enqueued records reach disk.
        if (typeof mod.drainFeedback === "function") {
          await mod.drainFeedback();
        }
      } catch { /* swallow */ }
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
