// disable: → .disabled-skila/.
import { findSkill } from "../inventory/scanner.js";
import { moveSkillDir } from "./_lifecycle.js";
export async function runDisable(name) {
    const skill = findSkill(name);
    if (!skill)
        throw new Error(`disable: skill not found: ${name}`);
    return { destination: await moveSkillDir(skill, "disabled") };
}
//# sourceMappingURL=disable.js.map