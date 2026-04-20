// reactivate: disabled → published.
import { findSkill } from "../inventory/scanner.js";
import { moveSkillDir } from "./_lifecycle.js";
export async function runReactivate(name) {
    const skill = findSkill(name);
    if (!skill)
        throw new Error(`reactivate: skill not found: ${name}`);
    if (skill.status !== "disabled")
        throw new Error(`reactivate: expected status=disabled, got ${skill.status}`);
    return { destination: await moveSkillDir(skill, "published") };
}
//# sourceMappingURL=reactivate.js.map