// Lifecycle helpers shared by promote/graduate/archive/disable/reactivate/reject.
// Phase 4: routes writes through StorageAdapter (git or flat). Live tree
// mirroring is performed by the adapter (or by this module's fallback) so
// existing Phase 2 contracts are preserved.

import { existsSync, mkdirSync, renameSync, rmSync, readFileSync, copyFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Skill, SkillStatus, SkillFrontmatter } from "../types.js";
import { statusDir } from "../config/config.js";
import { parseSkillFile, serializeSkillFile } from "../inventory/frontmatter.js";
import { atomicWriteFileSync } from "../storage/atomic.js";
import { getAdapter } from "../storage/index.js";

function copyDirRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    const st = statSync(s);
    if (st.isDirectory()) copyDirRecursive(s, d);
    else copyFileSync(s, d);
  }
}

function rmDir(p: string): void {
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

export async function moveSkillDir(skill: Skill, newStatus: SkillStatus): Promise<string> {
  const srcDir = dirname(skill.path);
  const destBase = statusDir(newStatus);
  mkdirSync(destBase, { recursive: true });
  const destDir = join(destBase, skill.name);
  if (existsSync(destDir)) rmDir(destDir);
  // Try rename, fallback to copy+remove (cross-device).
  try {
    renameSync(srcDir, destDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EXDEV") {
      copyDirRecursive(srcDir, destDir);
      rmDir(srcDir);
    } else {
      throw err;
    }
  }
  // Update frontmatter status atomically via adapter (records history).
  const skillFile = join(destDir, "SKILL.md");
  const raw = readFileSync(skillFile, "utf8");
  const parsed = parseSkillFile(raw);
  parsed.frontmatter.skila.status = newStatus;
  parsed.frontmatter.skila.lastImprovedAt = new Date().toISOString();
  const serialized = serializeSkillFile(parsed.frontmatter, parsed.body);

  // Write live + adapter history
  atomicWriteFileSync(skillFile, serialized);
  try {
    const adapter = await getAdapter();
    await adapter.moveSkill(skill.name, skill.status, newStatus);
    await adapter.writeSkill(skill.name, parsed.frontmatter.skila.version, serialized, {
      message: `move ${skill.name}: ${skill.status}->${newStatus}`,
      status: newStatus
    });
  } catch (err) {
    // Adapter mismatch (Scenario C) must surface; other errors do not break the move.
    if ((err as { code?: string })?.code === "E_ADAPTER_MISMATCH") throw err;
  }
  return destDir;
}

export function appendChangelog(fm: SkillFrontmatter, version: string, change: string): void {
  if (!Array.isArray(fm.skila.changelog)) fm.skila.changelog = [];
  fm.skila.changelog.push({ version, date: new Date().toISOString(), change });
}

export function bumpVersion(version: string, kind: "patch" | "minor" | "major"): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return "0.1.0";
  let [_, maj, min, pat] = m;
  let major = parseInt(maj, 10), minor = parseInt(min, 10), patch = parseInt(pat, 10);
  if (kind === "major") { major++; minor = 0; patch = 0; }
  else if (kind === "minor") { minor++; patch = 0; }
  else patch++;
  return `${major}.${minor}.${patch}`;
}

export async function writeSkillFile(dir: string, fm: SkillFrontmatter, body: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  const serialized = serializeSkillFile(fm, body);
  // Live write (Phase 2 contract: file exists immediately after this returns).
  atomicWriteFileSync(file, serialized);
  // Adapter history.
  try {
    const adapter = await getAdapter();
    await adapter.writeSkill(fm.name, fm.skila.version, serialized, {
      message: `${fm.skila.source} ${fm.name} v${fm.skila.version}`,
      status: fm.skila.status
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "E_ADAPTER_MISMATCH") throw err;
  }
  return file;
}

// Synchronous live-tree-only write helper, used by paths that must not await
// (e.g. validation prefetch). Does NOT record history.
export function writeSkillFileLiveOnly(dir: string, fm: SkillFrontmatter, body: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  atomicWriteFileSync(file, serializeSkillFile(fm, body));
  return file;
}
