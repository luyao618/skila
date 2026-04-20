// Smithery stdio MCP server — D5 isolation.
// - SKILA_HOME = an UNPREDICTABLE mkdtemp dir under tmpdir() (FIX-M16)
// - Flat-only adapter forced
// - Mutation commands disabled (only inspect/list/lint exposed)
// - Boot scans /tmp/skila-smithery-* and removes orphans (mtime > 1h),
//   refusing to follow symlinks (FIX-M16).

import { mkdtempSync, mkdirSync, readdirSync, statSync, lstatSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORPHAN_AGE_MS = 60 * 60 * 1000;
const SMITHERY_PREFIX = "skila-smithery-";

let _activeHome: string | null = null;

/**
 * FIX-M16: Returns a freshly-minted, OS-randomised directory under tmpdir().
 * Caller must remember the returned path; PID-based prediction is no longer
 * possible. We keep the legacy "skila-smithery-" prefix so pruneOrphan…
 * still recognises old-format leftovers.
 */
export function createSmitheryHome(): string {
  if (_activeHome) return _activeHome;
  const dir = mkdtempSync(join(tmpdir(), SMITHERY_PREFIX));
  _activeHome = dir;
  return dir;
}

/**
 * Legacy alias kept for tests; returns the active mkdtemp dir if booted, else
 * a deterministic-but-still-prefixed fallback (used only by tests that pre-date
 * FIX-M16 — still under tmpdir, still prefixed, but no symlink-follow risk).
 */
export function smitheryHomeForPid(pid = process.pid): string {
  if (_activeHome) return _activeHome;
  return join(tmpdir(), `${SMITHERY_PREFIX}${pid}`);
}

export function pruneOrphanSmitheryDirs(): string[] {
  const t = tmpdir();
  const removed: string[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(t); } catch { return removed; }
  for (const e of entries) {
    if (!e.startsWith(SMITHERY_PREFIX)) continue;
    const full = join(t, e);
    try {
      // FIX-M16: lstat (no symlink follow). If somebody pre-planted a symlink
      // /tmp/skila-smithery-foo -> /etc, we MUST NOT delete /etc. We delete only
      // when the entry is a real directory.
      const lst = lstatSync(full);
      if (lst.isSymbolicLink()) continue;
      if (!lst.isDirectory()) continue;
      const st = statSync(full);
      if (Date.now() - st.mtimeMs > ORPHAN_AGE_MS) {
        rmSync(full, { recursive: true, force: true });
        removed.push(full);
      }
    } catch { /* race */ }
  }
  return removed;
}

const READ_ONLY_COMMANDS = new Set(["inspect", "list", "lint"]);
const MUTATION_COMMANDS = new Set([
  "distill", "promote", "graduate", "reject", "archive",
  "disable", "reactivate", "rollback", "feedback"
]);

export interface McpRequest { method: string; params?: any; id?: number | string }

export async function handleMcpRequest(req: McpRequest): Promise<any> {
  const cmd = (req.method ?? "").replace(/^skila\./, "");
  if (MUTATION_COMMANDS.has(cmd)) {
    return { error: `command disabled in Smithery mode: ${cmd}` };
  }
  if (!READ_ONLY_COMMANDS.has(cmd)) {
    return { error: `unknown command: ${cmd}` };
  }
  if (cmd === "list") {
    const { runList } = await import("../commands/list.js");
    return { result: runList(req.params?.status) };
  }
  if (cmd === "inspect") {
    const { runInspect } = await import("../commands/inspect.js");
    return { result: runInspect(req.params?.name, req.params?.version) };
  }
  if (cmd === "lint") {
    const { runLint } = await import("../commands/lint.js");
    return { result: runLint(req.params?.target) };
  }
  return { error: "unreachable" };
}

export function bootMcp(): { home: string; orphansRemoved: string[] } {
  const home = createSmitheryHome();
  mkdirSync(home, { recursive: true });
  process.env.SKILA_HOME = home;
  process.env.SKILA_SMITHERY = "1";
  const orphansRemoved = pruneOrphanSmitheryDirs();
  return { home, orphansRemoved };
}

// Stdio loop. Reads JSON-RPC-ish lines, writes JSON responses. Designed for
// minimal Smithery handshake (Phase 3 will replace with real MCP SDK).
export async function runMcpServer(): Promise<void> {
  const { home, orphansRemoved } = bootMcp();
  // Emit a single ready line so test harnesses can sync.
  process.stdout.write(JSON.stringify({ type: "ready", home, orphansRemoved }) + "\n");
  process.stdin.setEncoding("utf8");
  let buf = "";
  process.stdin.on("data", async (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const req = JSON.parse(line) as McpRequest;
        const resp = await handleMcpRequest(req);
        process.stdout.write(JSON.stringify({ id: req.id, ...resp }) + "\n");
      } catch (e) {
        process.stdout.write(JSON.stringify({ error: (e as Error).message }) + "\n");
      }
    }
  });
  // Cleanup on exit
  const cleanup = () => {
    try {
      if (existsSync(home)) rmSync(home, { recursive: true, force: true });
    } catch { /* best-effort */ }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  // Keep alive until killed.
  await new Promise<void>(() => { /* never resolves */ });
}
