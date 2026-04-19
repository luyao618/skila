// Lifecycle helpers shared by promote/graduate/archive/disable/reactivate/reject.

import { existsSync, mkdirSync, renameSync, rmSync, readFileSync, writeFileSync, copyFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import type { Skill, SkillStatus, SkillFrontmatter } from "../types.js";
import { statusDir } from "../config/config.js";
import { parseSkillFile, serializeSkillFile } from "../inventory/frontmatter.js";
import { atomicWriteFileSync } from "../storage/atomic.js";

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
  // Update frontmatter status
  const skillFile = join(destDir, "SKILL.md");
  const raw = readFileSync(skillFile, "utf8");
  const parsed = parseSkillFile(raw);
  parsed.frontmatter.skila.status = newStatus;
  parsed.frontmatter.skila.lastImprovedAt = new Date().toISOString();
  atomicWriteFileSync(skillFile, serializeSkillFile(parsed.frontmatter, parsed.body));
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

export function writeSkillFile(dir: string, fm: SkillFrontmatter, body: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  atomicWriteFileSync(file, serializeSkillFile(fm, body));
  return file;
}
