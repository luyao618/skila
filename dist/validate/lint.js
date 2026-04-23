// ADVISORY linter. Always returns warnings, never throws.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseSkillFile } from "../inventory/frontmatter.js";
export function lintSkillContent(raw) {
    const warnings = [];
    let parsed;
    try {
        parsed = parseSkillFile(raw);
    }
    catch (e) {
        warnings.push({ rule: "parse", message: e.message });
        return warnings;
    }
    const fm = parsed.frontmatter;
    if (fm.description && fm.description.length < 40) {
        warnings.push({ rule: "description-too-short", message: "description <40 chars; consider adding triggering cues" });
    }
    if (parsed.body.trim().length < 100) {
        warnings.push({ rule: "body-too-short", message: "skill body <100 chars; might lack instructions" });
    }
    return warnings;
}
export function lintSkillDir(skillDir) {
    const warnings = [];
    if (!existsSync(skillDir) || !statSync(skillDir).isDirectory())
        return warnings;
    const skillMdPath = join(skillDir, "SKILL.md");
    let body = "";
    if (existsSync(skillMdPath)) {
        try {
            const raw = readFileSync(skillMdPath, "utf8");
            const lines = raw.split("\n");
            if (lines.length > 500) {
                warnings.push({ rule: "skill-md-too-long", message: "SKILL.md exceeds 500 lines; consider splitting to references/" });
            }
            body = raw;
        }
        catch { /* ignore */ }
    }
    const KNOWN_SUBDIRS = new Set(["scripts", "references", "assets", ".git"]);
    const SUPPORTING_SUBDIRS = ["scripts", "references", "assets"];
    let entries;
    try {
        entries = readdirSync(skillDir);
    }
    catch {
        return warnings;
    }
    for (const entry of entries) {
        const full = join(skillDir, entry);
        try {
            if (statSync(full).isDirectory() && !KNOWN_SUBDIRS.has(entry)) {
                warnings.push({ rule: "unknown-subdirectory", message: `Unknown subdirectory: ${entry}` });
            }
        }
        catch { /* ignore */ }
    }
    for (const subdir of SUPPORTING_SUBDIRS) {
        const subdirPath = join(skillDir, subdir);
        if (!existsSync(subdirPath) || !statSync(subdirPath).isDirectory())
            continue;
        const walk = (dir, prefix) => {
            let dirEntries;
            try {
                dirEntries = readdirSync(dir);
            }
            catch {
                return;
            }
            for (const e of dirEntries) {
                const full = join(dir, e);
                const rel = prefix ? `${prefix}/${e}` : e;
                try {
                    if (statSync(full).isDirectory()) {
                        walk(full, rel);
                    }
                    else {
                        const filePath = `${subdir}/${rel}`;
                        if (!body.includes(filePath) && !body.includes(e)) {
                            warnings.push({ rule: "unreferenced-supporting-file", message: `Supporting file ${filePath} not referenced in SKILL.md` });
                        }
                    }
                }
                catch { /* ignore */ }
            }
        };
        walk(subdirPath, "");
    }
    return warnings;
}
//# sourceMappingURL=lint.js.map