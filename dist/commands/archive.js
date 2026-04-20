// archive: published → archived.
import { findSkill } from "../inventory/scanner.js";
import { moveSkillDir } from "./_lifecycle.js";
export async function runArchive(name) {
    const skill = findSkill(name);
    if (!skill)
        throw new Error(`archive: skill not found: ${name}`);
    if (skill.status !== "published")
        throw new Error(`archive: expected status=published, got ${skill.status}`);
    return { destination: await moveSkillDir(skill, "archived") };
}
//# sourceMappingURL=archive.js.map