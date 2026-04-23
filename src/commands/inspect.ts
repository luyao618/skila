// CLI: skila inspect <name> [--version v0.X.Y].
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { findSkill } from "../inventory/scanner.js";
import { ensureSkilaHome } from "../config/config.js";
import { getAdapter } from "../storage/index.js";

export async function runInspect(name: string, version?: string): Promise<{ path: string; content: string }> {
  if (version) {
    const ver = version.startsWith("v") ? version.slice(1) : version;
    const v = `v${ver}`;
    // Try legacy versions tree first.
    const home = ensureSkilaHome();
    const file = join(home, "versions", name, v, "SKILL.md");
    if (existsSync(file)) {
      return { path: file, content: readFileSync(file, "utf8") };
    }
    // Fall back to storage adapter (git log search or flat snapshot).
    try {
      const adapter = await getAdapter();
      const content = await adapter.getVersion(name, ver);
      return { path: `adapter:${name}@${v}`, content };
    } catch { /* fall through */ }
    throw new Error(`inspect: version not found: ${name}@${v}`);
  }
  const skill = findSkill(name);
  if (!skill) throw new Error(`inspect: skill not found: ${name}`);
  let content = readFileSync(skill.path, "utf8");

  // Show supporting files
  const ALLOWED_SUBDIRS = ["scripts", "references", "assets"];
  const skillDir = dirname(skill.path);
  const supportingFiles: string[] = [];
  for (const subdir of ALLOWED_SUBDIRS) {
    const subdirPath = join(skillDir, subdir);
    if (existsSync(subdirPath)) {
      const walk = (dir: string, prefix: string) => {
        for (const e of readdirSync(dir)) {
          const full = join(dir, e);
          const rel = prefix ? `${prefix}/${e}` : e;
          if (statSync(full).isDirectory()) walk(full, rel);
          else supportingFiles.push(`${subdir}/${rel}`);
        }
      };
      walk(subdirPath, "");
    }
  }
  if (supportingFiles.length > 0) {
    content += "\n\n--- Supporting Files ---\n" + supportingFiles.map(f => `  ${f}`).join("\n") + "\n";
  }

  return { path: skill.path, content };
}
