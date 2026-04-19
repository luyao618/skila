#!/usr/bin/env node
// skila feedback hook bridge (CommonJS for plugin.json compatibility).
// Phase 1: no-op; reads stdin (Claude Code hook input JSON), discards it,
// exits 0 within ~100ms. Real implementation lands in Phase 2:
//   - parses {event, tool, result, session} from stdin
//   - resolves dist/cli.js via path.resolve(__dirname, '..', 'cli.js')
//   - delegates to collectFeedback(...) under withLock(feedback.json)

"use strict";

const path = require("path");

// Resolve the sibling CLI bundle path (used in phase 2 to delegate work).
// Computed eagerly so any path-resolution error surfaces in logs immediately.
const CLI_PATH = path.resolve(__dirname, "..", "cli.js");
void CLI_PATH;

const HARD_BUDGET_MS = 100;
const watchdog = setTimeout(() => {
  // Belt-and-suspenders: ensure we never hold the hook channel open past budget.
  process.exit(0);
}, HARD_BUDGET_MS);
watchdog.unref();

// Drain stdin without doing any work (Phase 1 stub). Resolves promptly even
// when no payload is piped (e.g. test invocation).
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  if (buf.length > 1024 * 64) {
    // Cap buffered payload to keep memory bounded; surplus bytes are ignored.
    buf = buf.slice(0, 1024 * 64);
  }
});
process.stdin.on("end", () => {
  clearTimeout(watchdog);
  process.exit(0);
});
process.stdin.on("error", () => {
  clearTimeout(watchdog);
  process.exit(0);
});

// If stdin is a TTY (no pipe attached), exit immediately.
if (process.stdin.isTTY) {
  clearTimeout(watchdog);
  process.exit(0);
}
