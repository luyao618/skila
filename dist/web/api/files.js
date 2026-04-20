// GET /api/skills/:name/file?path=scripts/foo.ts — read individual supporting file
// PUT /api/skills/:name/file — write individual supporting file (non-SKILL.md), commits via storage adapter
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize, dirname } from "node:path";
import { findSkill } from "../../inventory/scanner.js";
import { getAdapter } from "../../storage/index.js";
import { sendJson } from "../middleware/token.js";
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
function safeJoin(skillDir, filePath) {
    const normalized = normalize(filePath).replace(/^(\.\.\/|\/)+/, "");
    if (normalized.includes(".."))
        return null;
    const abs = join(skillDir, normalized);
    if (!abs.startsWith(skillDir + "/") && abs !== skillDir)
        return null;
    return abs;
}
export async function handleGetFile(req, res, name, filePath) {
    const skill = findSkill(name);
    if (!skill) {
        sendJson(res, 404, { error: `skill not found: ${name}` });
        return;
    }
    const skillDir = dirname(skill.path);
    const abs = safeJoin(skillDir, filePath);
    if (!abs) {
        sendJson(res, 400, { error: "path traversal not allowed" });
        return;
    }
    if (!existsSync(abs)) {
        sendJson(res, 404, { error: `file not found: ${filePath}` });
        return;
    }
    const normalized = normalize(filePath).replace(/^(\.\.\/|\/)+/, "");
    const content = readFileSync(abs, "utf8");
    const mtime = statSync(abs).mtime.toISOString();
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
    const skill = findSkill(name);
    if (!skill) {
        sendJson(res, 404, { error: `skill not found: ${name}` });
        return;
    }
    const skillDir = dirname(skill.path);
    const abs = safeJoin(skillDir, normalized);
    if (!abs) {
        sendJson(res, 400, { error: "path traversal not allowed" });
        return;
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
    const newMtime = statSync(abs).mtime.toISOString();
    sendJson(res, 200, { ok: true, path: normalized, mtime: newMtime });
}
//# sourceMappingURL=files.js.map