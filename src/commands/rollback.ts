// rollback: creates a new current version bytes-equal old; bumps revisionCount;
// appends changelog. Old historical files preserved alongside under
// versions/<name>/v0.X.Y/SKILL.md (Phase 4 git/flat adapter takes over later).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findSkill } from "../inventory/scanner.js";
import { ensureSkilaHome } from "../config/config.js";
import { atomicWriteFileSync } from "../storage/atomic.js";
import { parseSkillFile, serializeSkillFile } from "../inventory/frontmatter.js";
import { appendChangelog, bumpVersion } from "./_lifecycle.js";

export async function runRollback(name: string, toVersion: string): Promise<{ newVersion: string; path: string }> {
  const skill = findSkill(name);
  if (!skill) throw new Error(`rollback: skill not found: ${name}`);
  // Look up historical bytes from versions/<name>/v<toVersion>/SKILL.md
  const home = ensureSkilaHome();
  const histDir = join(home, "versions", name, `v${toVersion}`);
  const histFile = join(histDir, "SKILL.md");
  if (!existsSync(histFile)) throw new Error(`rollback: historical version not found: v${toVersion}`);
  const histRaw = readFileSync(histFile, "utf8");
  const histParsed = parseSkillFile(histRaw);

  const newVersion = bumpVersion(skill.frontmatter.skila.version, "minor");
  const fm = { ...histParsed.frontmatter };
  fm.skila = {
    ...fm.skila,
    version: newVersion,
    parentVersion: skill.frontmatter.skila.version,
    revisionCount: (skill.frontmatter.skila.revisionCount ?? 0) + 1,
    lastImprovedAt: new Date().toISOString(),
    status: skill.status,
    source: "skila-rollback",
    changelog: [...(skill.frontmatter.skila.changelog ?? [])]
  };
  appendChangelog(fm, newVersion, `Rolled back to v${toVersion}`);
  atomicWriteFileSync(skill.path, serializeSkillFile(fm, histParsed.body));
  return { newVersion, path: skill.path };
}

// Snapshot helper used by other commands to record version history.
export function snapshotVersion(name: string, version: string, raw: string): string {
  const home = ensureSkilaHome();
  const dir = join(home, "versions", name, `v${version}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  atomicWriteFileSync(file, raw);
  return file;
}
