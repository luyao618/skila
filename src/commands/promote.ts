// promote: draft → published (atomic move).

import { findSkill } from "../inventory/scanner.js";
import { moveSkillDir } from "./_lifecycle.js";

export async function runPromote(name: string): Promise<{ destination: string }> {
  const skill = findSkill(name);
  if (!skill) throw new Error(`promote: skill not found: ${name}`);
  if (skill.status !== "draft") throw new Error(`promote: expected status=draft, got ${skill.status}`);
  const dest = await moveSkillDir(skill, "published");
  return { destination: dest };
}
