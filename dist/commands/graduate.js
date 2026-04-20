// graduate: staging → published.
import { findSkill } from "../inventory/scanner.js";
import { moveSkillDir } from "./_lifecycle.js";
export async function runGraduate(name) {
    const skill = findSkill(name);
    if (!skill)
        throw new Error(`graduate: skill not found: ${name}`);
    if (skill.status !== "staging")
        throw new Error(`graduate: expected status=staging, got ${skill.status}`);
    const dest = await moveSkillDir(skill, "published");
    return { destination: dest };
}
//# sourceMappingURL=graduate.js.map