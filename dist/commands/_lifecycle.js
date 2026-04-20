// Lifecycle helpers shared by promote/graduate/archive/disable/reactivate/reject.
// Phase 4: routes writes through StorageAdapter (git or flat). Live tree
// mirroring is performed by the adapter (or by this module's fallback) so
// existing Phase 2 contracts are preserved.
import { existsSync, mkdirSync, renameSync, rmSync, readFileSync, copyFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { statusDir } from "../config/config.js";
import { parseSkillFile, serializeSkillFile } from "../inventory/frontmatter.js";
import { atomicWriteFileSync } from "../storage/atomic.js";
import { getAdapter } from "../storage/index.js";
function copyDirRecursive(src, dst) {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src)) {
        const s = join(src, entry);
        const d = join(dst, entry);
        const st = statSync(s);
        if (st.isDirectory())
            copyDirRecursive(s, d);
        else
            copyFileSync(s, d);
    }
}
function rmDir(p) {
    if (existsSync(p))
        rmSync(p, { recursive: true, force: true });
}
export async function moveSkillDir(skill, newStatus) {
    const srcDir = dirname(skill.path);
    const destBase = statusDir(newStatus);
    mkdirSync(destBase, { recursive: true });
    const destDir = join(destBase, skill.name);
    if (existsSync(destDir))
        rmDir(destDir);
    // Try rename, fallback to copy+remove (cross-device).
    try {
        renameSync(srcDir, destDir);
    }
    catch (err) {
        const code = err.code;
        if (code === "EXDEV") {
            copyDirRecursive(srcDir, destDir);
            rmDir(srcDir);
        }
        else {
            throw err;
        }
    }
    // Update frontmatter status atomically via adapter (records history).
    const skillFile = join(destDir, "SKILL.md");
    const raw = readFileSync(skillFile, "utf8");
    const parsed = parseSkillFile(raw);
    parsed.frontmatter.skila.status = newStatus;
    parsed.frontmatter.skila.lastImprovedAt = new Date().toISOString();
    const serialized = serializeSkillFile(parsed.frontmatter, parsed.body);
    // Write live + adapter history
    try {
        atomicWriteFileSync(skillFile, serialized);
    }
    catch (writeErr) {
        // Roll back the directory move so FS state is consistent on failure.
        try {
            renameSync(destDir, srcDir);
        }
        catch {
            try {
                copyDirRecursive(destDir, srcDir);
                rmDir(destDir);
            }
            catch { /* best effort */ }
        }
        const e = writeErr;
        const ctx = new Error(`moveSkillDir: failed to write ${skillFile}: ${e.message}`);
        ctx.code = e.code;
        ctx.cause = writeErr;
        throw ctx;
    }
    try {
        const adapter = await getAdapter();
        await adapter.moveSkill(skill.name, skill.status, newStatus);
        await adapter.writeSkill(skill.name, parsed.frontmatter.skila.version, serialized, {
            message: `move ${skill.name}: ${skill.status}->${newStatus}`,
            status: newStatus
        });
    }
    catch (err) {
        // E_ADAPTER_MISMATCH is a known, recoverable mismatch — swallow it.
        // All other adapter errors are unexpected and must surface with context.
        const code = err?.code;
        if (code !== "E_ADAPTER_MISMATCH") {
            const msg = err.message ?? String(err);
            const ctx = new Error(`moveSkillDir: adapter error (${code ?? "unknown"}): ${msg}`);
            ctx.code = code;
            ctx.cause = err;
            throw ctx;
        }
    }
    return destDir;
}
export function appendChangelog(fm, version, change) {
    if (!Array.isArray(fm.skila.changelog))
        fm.skila.changelog = [];
    fm.skila.changelog.push({ version, date: new Date().toISOString(), change });
}
export function bumpVersion(version, kind) {
    const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!m)
        return "0.1.0";
    let [_, maj, min, pat] = m;
    let major = parseInt(maj, 10), minor = parseInt(min, 10), patch = parseInt(pat, 10);
    if (kind === "major") {
        major++;
        minor = 0;
        patch = 0;
    }
    else if (kind === "minor") {
        minor++;
        patch = 0;
    }
    else
        patch++;
    return `${major}.${minor}.${patch}`;
}
export async function writeSkillFile(dir, fm, body) {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "SKILL.md");
    const serialized = serializeSkillFile(fm, body);
    // Live write (Phase 2 contract: file exists immediately after this returns).
    atomicWriteFileSync(file, serialized);
    // Adapter history.
    try {
        const adapter = await getAdapter();
        await adapter.writeSkill(fm.name, fm.skila.version, serialized, {
            message: `${fm.skila.source} ${fm.name} v${fm.skila.version}`,
            status: fm.skila.status
        });
    }
    catch (err) {
        if (err?.code === "E_ADAPTER_MISMATCH")
            throw err;
    }
    return file;
}
// Synchronous live-tree-only write helper, used by paths that must not await
// (e.g. validation prefetch). Does NOT record history.
export function writeSkillFileLiveOnly(dir, fm, body) {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "SKILL.md");
    atomicWriteFileSync(file, serializeSkillFile(fm, body));
    return file;
}
//# sourceMappingURL=_lifecycle.js.map