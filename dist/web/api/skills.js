// GET /api/skills — list all skills across 5 status buckets
// GET /api/skills/:name — full skill details
// PUT /api/skills/:name — save SKILL.md edit
// POST /api/skills/:name/feedback — manual feedback record
import { existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { scanInventory, findSkill } from "../../inventory/scanner.js";
import { validateSkillContent } from "../../validate/validate.js";
import { atomicWriteFileSync } from "../../storage/atomic.js";
import { getAdapter } from "../../storage/index.js";
import { incrementUsage } from "../../feedback/store.js";
import { sendJson } from "../middleware/token.js";
import { bumpAndAppend, writeSidecar } from "../../inventory/sidecar.js";
function skillSummary(s) {
    const skila = s.skila;
    return {
        name: s.name,
        status: s.status,
        version: skila.version || "0.0.0",
        description: s.frontmatter.description ?? "",
        revisionCount: skila.revisionCount ?? 0,
        lastImprovedAt: skila.lastImprovedAt || null,
        source: skila.source ?? "unknown",
        parentVersion: skila.parentVersion ?? null,
        warnings: s.frontmatter._warnings ?? [],
    };
}
function listDirFiles(dir, sub) {
    const d = join(dir, sub);
    if (!existsSync(d))
        return [];
    try {
        return readdirSync(d)
            .filter((f) => !statSync(join(d, f)).isDirectory())
            .map((f) => `${sub}/${f}`);
    }
    catch {
        return [];
    }
}
export async function handleGetSkills(req, res) {
    const skills = scanInventory().map(skillSummary);
    sendJson(res, 200, skills);
}
export async function handleGetSkill(req, res, name) {
    const skill = findSkill(name);
    if (!skill) {
        sendJson(res, 404, { error: `skill not found: ${name}` });
        return;
    }
    const dir = dirname(skill.path);
    const scripts = listDirFiles(dir, "scripts");
    const references = listDirFiles(dir, "references");
    const assets = listDirFiles(dir, "assets");
    // Send SKILL.md as-is — already clean (no skila block). The editor
    // round-trips disk bytes exactly without any transparent re-injection.
    const fullContent = readFileSync(skill.path, "utf8");
    sendJson(res, 200, {
        ...skillSummary(skill),
        body: fullContent,
        rawContent: fullContent,
        scripts,
        references,
        assets,
        mtime: statSync(skill.path).mtime.toISOString(),
    });
}
export async function handlePutSkill(req, res, name) {
    let body = "";
    for await (const chunk of req)
        body += chunk;
    let payload;
    try {
        payload = JSON.parse(body);
    }
    catch {
        sendJson(res, 400, { error: "invalid JSON body" });
        return;
    }
    const { content } = payload;
    if (typeof content !== "string") {
        sendJson(res, 400, { error: "body.content must be a string" });
        return;
    }
    // Validate just the SKILL.md (name + description + dir match).
    try {
        validateSkillContent(content, { expectedDirName: name });
    }
    catch (e) {
        sendJson(res, 422, { error: "validation failed", errors: e.errors ?? [e.message] });
        return;
    }
    // mtime check (optimistic concurrency)
    const skill = findSkill(name);
    if (!skill) {
        sendJson(res, 404, { error: `skill not found: ${name}` });
        return;
    }
    if (payload.mtime) {
        const diskMtime = statSync(skill.path).mtime.toISOString();
        if (diskMtime !== payload.mtime) {
            sendJson(res, 409, { error: "conflict: skill was modified since last read", diskMtime });
            return;
        }
    }
    // Bump sidecar and record a changelog entry. Disk SKILL.md = user bytes.
    const nextSidecar = bumpAndAppend(skill.skila, `web edit (was v${skill.skila.version || "0.0.0"})`, "user-edit-via-web");
    // Preserve on-disk status (don't let stale sidecar override reality).
    nextSidecar.status = skill.status;
    // Write SKILL.md exactly as the user provided it + updated sidecar.
    atomicWriteFileSync(skill.path, content);
    writeSidecar(skill.path, nextSidecar);
    try {
        const adapter = await getAdapter();
        await adapter.writeSkill(name, nextSidecar.version, content, {
            message: `web-edit ${name} v${nextSidecar.version}`,
            status: nextSidecar.status,
            sidecar: nextSidecar,
        });
    }
    catch { /* best effort */ }
    sendJson(res, 200, {
        ok: true,
        version: nextSidecar.version,
        mtime: statSync(skill.path).mtime.toISOString(),
    });
}
export async function handlePostFeedback(req, res, name) {
    let rawBody = "";
    for await (const chunk of req)
        rawBody += chunk;
    let payload = {};
    try {
        if (rawBody)
            payload = JSON.parse(rawBody);
    }
    catch { /* ignore */ }
    const outcome = payload.outcome ?? "unknown";
    await incrementUsage(name, outcome);
    sendJson(res, 200, { ok: true });
}
//# sourceMappingURL=skills.js.map