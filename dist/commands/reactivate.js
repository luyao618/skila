// reactivate: archived → published.
import { findSkill } from "../inventory/scanner.js";
import { moveSkillDir } from "./_lifecycle.js";
export async function runReactivate(name) {
    const skill = findSkill(name);
    if (!skill)
        throw new Error(`reactivate: skill not found: ${name}`);
    if (skill.status !== "archived")
        throw new Error(`reactivate: expected status=archived, got ${skill.status}`);
    return { destination: await moveSkillDir(skill, "published") };
}
//# sourceMappingURL=reactivate.js.map