// ADVISORY linter. Always returns warnings, never throws.

import { parseSkillFile } from "../inventory/frontmatter.js";

export interface LintWarning {
  rule: string;
  message: string;
}

export function lintSkillContent(raw: string): LintWarning[] {
  const warnings: LintWarning[] = [];
  let parsed;
  try {
    parsed = parseSkillFile(raw);
  } catch (e) {
    warnings.push({ rule: "parse", message: (e as Error).message });
    return warnings;
  }
  const fm = parsed.frontmatter;
  if (fm.description && fm.description.length < 40) {
    warnings.push({ rule: "description-too-short", message: "description <40 chars; consider adding triggering cues" });
  }
  if (parsed.body.trim().length < 100) {
    warnings.push({ rule: "body-too-short", message: "skill body <100 chars; might lack instructions" });
  }
  if (fm.skila && Array.isArray(fm.skila.changelog) && fm.skila.changelog.length === 0) {
    warnings.push({ rule: "empty-changelog", message: "changelog is empty" });
  }
  return warnings;
}
