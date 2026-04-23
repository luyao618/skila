// CLI command: skila files — manage supporting files for skills.
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, readFileSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { findSkill } from "../inventory/scanner.js";
import { atomicWriteFileSync } from "../storage/atomic.js";
const ALLOWED_SUBDIRS = new Set(["scripts", "references", "assets"]);
const MAX_FILE_BYTES = 1_048_576; // 1 MiB
function validateFilePath(filePath) {
    if (filePath.includes(".."))
        return "Path traversal (..) not allowed";
    if (filePath.startsWith("/"))
        return "Absolute paths not allowed";
    const parts = filePath.split("/");
    if (parts.length < 2)
        return "Path must be under scripts/, references/, or assets/";
    if (!ALLOWED_SUBDIRS.has(parts[0]))
        return `Invalid subdirectory '${parts[0]}'. Allowed: ${[...ALLOWED_SUBDIRS].join(", ")}`;
    return null;
}
/** Verify resolved path is contained within skillDir (symlink escape guard).
 *  Caller must ensure parent directory exists (e.g. via mkdirSync) before calling. */
function assertContained(target, skillDir) {
    const resolvedSkillDir = realpathSync(skillDir);
    const parentDir = dirname(target);
    let resolvedParent;
    try {
        resolvedParent = realpathSync(parentDir);
    }
    catch {
        return "Cannot resolve target parent directory";
    }
    if (!resolvedParent.startsWith(resolvedSkillDir + "/") && resolvedParent !== resolvedSkillDir) {
        return "Resolved path escapes skill directory (possible symlink attack)";
    }
    return null;
}
export function runFilesList(skillName) {
    const skill = findSkill(skillName);
    if (!skill)
        return { success: false, error: `Skill '${skillName}' not found` };
    const skillDir = dirname(skill.path);
    const files = [];
    for (const subdir of ALLOWED_SUBDIRS) {
        const subdirPath = join(skillDir, subdir);
        if (!existsSync(subdirPath) || !statSync(subdirPath).isDirectory())
            continue;
        const walk = (dir, prefix) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                const rel = prefix ? `${prefix}/${entry}` : entry;
                if (statSync(full).isDirectory())
                    walk(full, rel);
                else
                    files.push(`${subdir}/${rel}`);
            }
        };
        walk(subdirPath, "");
    }
    return { success: true, files };
}
export function runFilesWrite(skillName, filePath, contentSource) {
    const err = validateFilePath(filePath);
    if (err)
        return { success: false, error: err };
    const skill = findSkill(skillName);
    if (!skill)
        return { success: false, error: `Skill '${skillName}' not found` };
    // C2: restrict --content-file to cwd or skill directory
    let content;
    if (contentSource) {
        if (!existsSync(contentSource))
            return { success: false, error: `Source file not found: ${contentSource}` };
        const resolvedSource = realpathSync(contentSource);
        const cwd = realpathSync(process.cwd());
        const skillDir = realpathSync(dirname(skill.path));
        if (!resolvedSource.startsWith(cwd + "/") && resolvedSource !== cwd
            && !resolvedSource.startsWith(skillDir + "/") && resolvedSource !== skillDir) {
            return { success: false, error: `--content-file must be within the current directory or skill directory` };
        }
        const buf = readFileSync(contentSource);
        if (buf.length > MAX_FILE_BYTES)
            return { success: false, error: `File exceeds 1 MiB limit` };
        content = buf.toString("utf8");
    }
    else {
        return { success: false, error: "No content source: provide --content-file <path>" };
    }
    const skillDir = dirname(skill.path);
    const target = join(skillDir, filePath);
    // C1: create parent dir, then verify resolved path stays within skill directory
    mkdirSync(dirname(target), { recursive: true });
    const containErr = assertContained(target, skillDir);
    if (containErr) {
        // Roll back: remove created dir if it's empty and didn't exist before
        return { success: false, error: containErr };
    }
    atomicWriteFileSync(target, content);
    return { success: true, message: `Written: ${filePath}` };
}
export function runFilesRemove(skillName, filePath) {
    const err = validateFilePath(filePath);
    if (err)
        return { success: false, error: err };
    const skill = findSkill(skillName);
    if (!skill)
        return { success: false, error: `Skill '${skillName}' not found` };
    const skillDir = dirname(skill.path);
    const target = join(skillDir, filePath);
    if (!existsSync(target))
        return { success: false, error: `File not found: ${filePath}` };
    // C1: verify resolved path stays within skill directory
    const containErr = assertContained(target, skillDir);
    if (containErr)
        return { success: false, error: containErr };
    unlinkSync(target);
    return { success: true, message: `Removed: ${filePath}` };
}
//# sourceMappingURL=files.js.map