// CLI command: skila files — manage supporting files for skills.
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, readFileSync, realpathSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
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
/** Verify resolved path is contained within skillDir (symlink escape guard). */
function assertContained(target, skillDir) {
    const resolvedSkillDir = realpathSync(skillDir);
    // For new files, check the parent dir (file itself may not exist yet)
    const parentDir = dirname(target);
    if (!existsSync(parentDir))
        return null; // parent will be created, validated by validateFilePath
    const resolvedParent = realpathSync(parentDir);
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
        const resolvedSource = resolve(contentSource);
        const cwd = process.cwd();
        const skillDir = dirname(skill.path);
        if (!resolvedSource.startsWith(cwd + "/") && resolvedSource !== cwd
            && !resolvedSource.startsWith(skillDir + "/") && resolvedSource !== skillDir) {
            return { success: false, error: `--content-file must be within the current directory or skill directory` };
        }
        if (!existsSync(contentSource))
            return { success: false, error: `Source file not found: ${contentSource}` };
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
    // C1: verify resolved path stays within skill directory
    mkdirSync(dirname(target), { recursive: true });
    const containErr = assertContained(target, skillDir);
    if (containErr)
        return { success: false, error: containErr };
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