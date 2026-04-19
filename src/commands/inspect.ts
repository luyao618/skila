// CLI: skila inspect <name> [--version v0.X.Y].
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { findSkill } from "../inventory/scanner.js";
import { ensureSkilaHome } from "../config/config.js";

export function runInspect(name: string, version?: string): { path: string; content: string } {
  if (version) {
    const home = ensureSkilaHome();
    const v = version.startsWith("v") ? version : `v${version}`;
    const file = join(home, "versions", name, v, "SKILL.md");
    if (!existsSync(file)) throw new Error(`inspect: version not found: ${name}@${v}`);
    return { path: file, content: readFileSync(file, "utf8") };
  }
  const skill = findSkill(name);
  if (!skill) throw new Error(`inspect: skill not found: ${name}`);
  return { path: skill.path, content: readFileSync(skill.path, "utf8") };
}
