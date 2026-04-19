// CLI: skila lint <path-or-name>.
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { lintSkillContent } from "../validate/lint.js";
import { validateSkillContent, SkilaValidationError } from "../validate/validate.js";
import { findSkill } from "../inventory/scanner.js";

export function runLint(target: string): { errors: string[]; warnings: { rule: string; message: string }[] } {
  let file: string | undefined;
  if (existsSync(target)) {
    const st = statSync(target);
    file = st.isDirectory() ? join(target, "SKILL.md") : target;
  } else {
    const skill = findSkill(target);
    if (skill) file = skill.path;
  }
  if (!file || !existsSync(file)) return { errors: [`not found: ${target}`], warnings: [] };
  const raw = readFileSync(file, "utf8");
  const errors: string[] = [];
  try {
    validateSkillContent(raw);
  } catch (e) {
    if (e instanceof SkilaValidationError) errors.push(...e.errors);
    else errors.push((e as Error).message);
  }
  const warnings = lintSkillContent(raw);
  return { errors, warnings };
}
