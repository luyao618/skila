// GET /api/skills/:name/file?path=scripts/foo.ts — read individual supporting file
import { existsSync, readFileSync } from "node:fs";
import { join, normalize, dirname } from "node:path";
import { findSkill } from "../../inventory/scanner.js";
import { sendJson } from "../middleware/token.js";
export async function handleGetFile(req, res, name, filePath) {
    const skill = findSkill(name);
    if (!skill) {
        sendJson(res, 404, { error: `skill not found: ${name}` });
        return;
    }
    // Safety: normalize, disallow path traversal
    const normalized = normalize(filePath).replace(/^(\.\.\/|\/)+/, "");
    if (normalized.includes("..")) {
        sendJson(res, 400, { error: "path traversal not allowed" });
        return;
    }
    const skillDir = dirname(skill.path);
    const abs = join(skillDir, normalized);
    if (!abs.startsWith(skillDir)) {
        sendJson(res, 400, { error: "path outside skill dir" });
        return;
    }
    if (!existsSync(abs)) {
        sendJson(res, 404, { error: `file not found: ${normalized}` });
        return;
    }
    const content = readFileSync(abs, "utf8");
    sendJson(res, 200, { path: normalized, content });
}
//# sourceMappingURL=files.js.map