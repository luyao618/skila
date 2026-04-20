// reject: staging → archive.
import { findSkill } from "../inventory/scanner.js";
import { moveSkillDir } from "./_lifecycle.js";
export async function runReject(name) {
    const skill = findSkill(name);
    if (!skill)
        throw new Error(`reject: skill not found: ${name}`);
    if (skill.status !== "staging")
        throw new Error(`reject: expected status=staging, got ${skill.status}`);
    return { destination: await moveSkillDir(skill, "archived") };
}
//# sourceMappingURL=reject.js.map