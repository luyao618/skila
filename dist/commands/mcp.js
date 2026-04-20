// Smithery stdio MCP server — D5 isolation.
// - SKILA_HOME = /tmp/skila-smithery-<pid>/
// - Flat-only adapter forced
// - Mutation commands disabled (only inspect/list/lint exposed)
// - Boot scans /tmp/skila-smithery-* and removes orphans (mtime > 1h).
import { mkdirSync, readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const ORPHAN_AGE_MS = 60 * 60 * 1000;
export function smitheryHomeForPid(pid = process.pid) {
    return join(tmpdir(), `skila-smithery-${pid}`);
}
export function pruneOrphanSmitheryDirs() {
    const t = tmpdir();
    const removed = [];
    let entries = [];
    try {
        entries = readdirSync(t);
    }
    catch {
        return removed;
    }
    for (const e of entries) {
        if (!e.startsWith("skila-smithery-"))
            continue;
        const full = join(t, e);
        try {
            const st = statSync(full);
            if (Date.now() - st.mtimeMs > ORPHAN_AGE_MS) {
                rmSync(full, { recursive: true, force: true });
                removed.push(full);
            }
        }
        catch { /* race */ }
    }
    return removed;
}
const READ_ONLY_COMMANDS = new Set(["inspect", "list", "lint"]);
const MUTATION_COMMANDS = new Set([
    "distill", "promote", "graduate", "reject", "archive",
    "disable", "reactivate", "rollback", "feedback"
]);
export async function handleMcpRequest(req) {
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
export function bootMcp() {
    const home = smitheryHomeForPid();
    mkdirSync(home, { recursive: true });
    process.env.SKILA_HOME = home;
    process.env.SKILA_SMITHERY = "1";
    const orphansRemoved = pruneOrphanSmitheryDirs();
    return { home, orphansRemoved };
}
// Stdio loop. Reads JSON-RPC-ish lines, writes JSON responses. Designed for
// minimal Smithery handshake (Phase 3 will replace with real MCP SDK).
export async function runMcpServer() {
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
            if (!line)
                continue;
            try {
                const req = JSON.parse(line);
                const resp = await handleMcpRequest(req);
                process.stdout.write(JSON.stringify({ id: req.id, ...resp }) + "\n");
            }
            catch (e) {
                process.stdout.write(JSON.stringify({ error: e.message }) + "\n");
            }
        }
    });
    // Cleanup on exit
    const cleanup = () => {
        try {
            if (existsSync(home))
                rmSync(home, { recursive: true, force: true });
        }
        catch { /* best-effort */ }
    };
    process.on("exit", cleanup);
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
    // Keep alive until killed.
    await new Promise(() => { });
}
//# sourceMappingURL=mcp.js.map