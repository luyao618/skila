// GET /api/skills/:name/file?path=scripts/foo.ts — read individual supporting file
// PUT /api/skills/:name/file — write individual supporting file (non-SKILL.md), commits via storage adapter
//
// FIX-C7: harden against path traversal and arbitrary-file disclosure.
//   1. realpathSync both root and target → defeats symlink escape
//   2. lstatSync rejects symlinks within the resolved chain
//   3. Token-gate the read endpoint (was previously open)
//   4. File-size cap (4 MiB) defeats /dev/zero hangs and OOM
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, normalize, dirname, sep } from "node:path";
import { findSkill } from "../../inventory/scanner.js";
import { getAdapter } from "../../storage/index.js";
import { sendJson, validateToken } from "../middleware/token.js";
const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MiB
const TEXT_EXT_ALLOWLIST = new Set([
    ".md", ".txt", ".json", ".yaml", ".yml",
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".sh", ".bash", ".zsh",
    ".toml", ".ini", ".env",
    ".css", ".scss", ".html", ".xml", ".csv",
    ".gitignore",
]);
function isTextPath(p) {
    const lower = p.toLowerCase();
    // Allow extensionless dotfiles by name
    const base = lower.split("/").pop() ?? "";
    if (base === ".gitignore" || base === ".env")
        return true;
    const dot = lower.lastIndexOf(".");
    if (dot < 0)
        return false;
    return TEXT_EXT_ALLOWLIST.has(lower.slice(dot));
}
/**
 * Resolve `filePath` inside `skillDir` with full hardening:
 *  - reject `..` after normalization
 *  - reject symlinks at the leaf
 *  - realpath both sides and require leaf to remain inside the realpath-ed root
 * Returns { realLeaf, normalized } on success, or null + error code on failure.
 */
function safeResolve(skillDir, filePath) {
    const normalized = normalize(filePath).replace(/^(\.\.\/|\/)+/, "");
    if (!normalized || normalized.includes("..")) {
        return { ok: false, status: 400, error: "path traversal not allowed" };
    }
    const abs = join(skillDir, normalized);
    return { ok: true, abs, realLeaf: abs, normalized };
}
export async function handleGetFile(req, res, name, filePath, serverToken) {
    // FIX-C7 (3): require auth even for reads; supporting files may contain secrets.
    if (!validateToken(req, res, serverToken))
        return;
    const skill = findSkill(name);
    if (!skill) {
        sendJson(res, 404, { error: `skill not found: ${name}` });
        return;
    }
    const skillDir = dirname(skill.path);
    const r = safeResolve(skillDir, filePath);
    if (!r.ok) {
        sendJson(res, r.status, { error: r.error });
        return;
    }
    const { abs, normalized } = r;
    if (!existsSync(abs)) {
        sendJson(res, 404, { error: `file not found: ${filePath}` });
        return;
    }
    // FIX-C7 (2): reject symlinks at the leaf so attackers cannot follow into outside files.
    let leafStat;
    try {
        leafStat = lstatSync(abs);
    }
    catch {
        sendJson(res, 404, { error: "file not found" });
        return;
    }
    if (leafStat.isSymbolicLink()) {
        sendJson(res, 403, { error: "symlinks not allowed" });
        return;
    }
    if (!leafStat.isFile()) {
        sendJson(res, 400, { error: "not a regular file" });
        return;
    }
    // FIX-C7 (1): realpath both sides; the resolved leaf must remain inside the resolved skill dir.
    let realLeaf;
    let realRoot;
    try {
        realLeaf = realpathSync(abs);
        realRoot = realpathSync(skillDir);
    }
    catch {
        sendJson(res, 404, { error: "file not found" });
        return;
    }
    const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
    if (realLeaf !== realRoot && !realLeaf.startsWith(rootWithSep)) {
        sendJson(res, 403, { error: "path outside skill dir" });
        return;
    }
    // FIX-C7 (4): cap size to defeat /dev/zero and similar.
    const sz = statSync(realLeaf).size;
    if (sz > MAX_FILE_BYTES) {
        sendJson(res, 413, { error: `file exceeds ${MAX_FILE_BYTES} byte cap`, size: sz });
        return;
    }
    const content = readFileSync(realLeaf, "utf8");
    const mtime = statSync(realLeaf).mtime.toISOString();
    sendJson(res, 200, { path: normalized, content, mtime });
}
export async function handlePutFile(req, res, name) {
    let raw = "";
    for await (const chunk of req)
        raw += chunk;
    let payload;
    try {
        payload = JSON.parse(raw);
    }
    catch {
        sendJson(res, 400, { error: "invalid JSON body" });
        return;
    }
    const { path: filePath, content, mtime } = payload;
    if (typeof filePath !== "string" || !filePath) {
        sendJson(res, 400, { error: "body.path required" });
        return;
    }
    if (typeof content !== "string") {
        sendJson(res, 400, { error: "body.content must be a string" });
        return;
    }
    const normalized = normalize(filePath).replace(/^(\.\.\/|\/)+/, "");
    if (normalized === "SKILL.md" || normalized.endsWith("/SKILL.md")) {
        sendJson(res, 400, { error: "use PUT /api/skills/:name to edit SKILL.md (frontmatter + version)" });
        return;
    }
    if (!isTextPath(normalized)) {
        sendJson(res, 400, { error: `not a text file (allowlisted extensions only): ${normalized}` });
        return;
    }
    if (content.length > MAX_FILE_BYTES) {
        sendJson(res, 413, { error: `content exceeds ${MAX_FILE_BYTES} byte cap` });
        return;
    }
    const skill = findSkill(name);
    if (!skill) {
        sendJson(res, 404, { error: `skill not found: ${name}` });
        return;
    }
    const skillDir = dirname(skill.path);
    const r = safeResolve(skillDir, normalized);
    if (!r.ok) {
        sendJson(res, r.status, { error: r.error });
        return;
    }
    const { abs } = r;
    // If the file already exists, refuse to follow a symlink (matches GET hardening).
    if (existsSync(abs)) {
        let leafStat;
        try {
            leafStat = lstatSync(abs);
        }
        catch { /* fallthrough */ }
        if (leafStat && leafStat.isSymbolicLink()) {
            sendJson(res, 403, { error: "symlinks not allowed" });
            return;
        }
    }
    // Optimistic concurrency
    if (mtime && existsSync(abs)) {
        const diskMtime = statSync(abs).mtime.toISOString();
        if (diskMtime !== mtime) {
            sendJson(res, 409, { error: "conflict: file was modified since last read", diskMtime });
            return;
        }
    }
    try {
        const adapter = await getAdapter();
        await adapter.writeFile(name, normalized, content, { message: `web-edit ${name}/${normalized}` });
    }
    catch (e) {
        sendJson(res, 500, { error: `write failed: ${e.message ?? e}` });
        return;
    }
    const newMtime = existsSync(abs) ? statSync(abs).mtime.toISOString() : new Date().toISOString();
    sendJson(res, 200, { ok: true, path: normalized, mtime: newMtime });
}
//# sourceMappingURL=files.js.map