// Lifecycle helpers shared by promote/graduate/archive/reactivate/reject.
// Phase 4: routes writes through StorageAdapter (git or flat). Live tree
// mirroring is performed by the adapter (or by this module's fallback) so
// existing Phase 2 contracts are preserved.
//
// Sidecar refactor: skila bookkeeping (version/changelog/source/etc.) lives
// in `<dir>/.skila.json`, NOT in SKILL.md frontmatter. Helpers here read +
// mutate the sidecar object explicitly and pass it to the storage adapter.

import { existsSync, mkdirSync, renameSync, rmSync, copyFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Skill, SkillStatus, SkillFrontmatter, SkilaMetadata } from "../types.js";
import { statusDir } from "../config/config.js";
import { serializeSkillFile } from "../inventory/frontmatter.js";
import { atomicWriteFileSync } from "../storage/atomic.js";
import { getAdapter } from "../storage/index.js";
import { writeSidecar, readSidecar } from "../inventory/sidecar.js";

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
  // Update sidecar (status + lastImprovedAt) atomically.
  const skillFile = join(destDir, "SKILL.md");
  const sidecar: SkilaMetadata = {
    ...skill.skila,
    status: newStatus,
    lastImprovedAt: new Date().toISOString(),
  };
  try {
    writeSidecar(skillFile, sidecar);
  } catch (writeErr) {
    // Roll back the directory move so FS state is consistent on failure.
    try { renameSync(destDir, srcDir); } catch { try { copyDirRecursive(destDir, srcDir); rmDir(destDir); } catch { /* best effort */ } }
    const e = writeErr as NodeJS.ErrnoException;
    const ctx = new Error(`moveSkillDir: failed to write sidecar for ${skillFile}: ${e.message}`);
    (ctx as any).code = e.code;
    (ctx as any).cause = writeErr;
    throw ctx;
  }

  // Record adapter history (rewrites SKILL.md as-is + sidecar).
  try {
    const adapter = await getAdapter();
    await adapter.moveSkill(skill.name, skill.status, newStatus);
    const raw = serializeSkillFile(skill.frontmatter, skill.body);
    await adapter.writeSkill(skill.name, sidecar.version, raw, {
      message: `move ${skill.name}: ${skill.status}->${newStatus}`,
      status: newStatus,
      sidecar
    });
  } catch (err) {
    // E_ADAPTER_MISMATCH is a known, recoverable mismatch — swallow it.
    // All other adapter errors are unexpected and must surface with context.
    const code = (err as { code?: string })?.code;
    if (code !== "E_ADAPTER_MISMATCH") {
      const msg = (err as Error).message ?? String(err);
      const ctx = new Error(`moveSkillDir: adapter error (${code ?? "unknown"}): ${msg}`);
      (ctx as any).code = code;
      (ctx as any).cause = err;
      throw ctx;
    }
  }
  return destDir;
}

export function appendChangelog(meta: SkilaMetadata, version: string, change: string): void {
  if (!Array.isArray(meta.changelog)) meta.changelog = [];
  meta.changelog.push({ version, date: new Date().toISOString(), change });
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

/**
 * Write SKILL.md (clean frontmatter + body) AND its sidecar to disk + adapter
 * history. Returns the SKILL.md path.
 */
export async function writeSkillFile(
  dir: string,
  fm: SkillFrontmatter,
  body: string,
  sidecar: SkilaMetadata
): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  const serialized = serializeSkillFile(fm, body);
  // Live writes (Phase 2 contract: file exists immediately after this returns).
  atomicWriteFileSync(file, serialized);
  writeSidecar(file, sidecar);
  // Adapter history.
  try {
    const adapter = await getAdapter();
    await adapter.writeSkill(fm.name, sidecar.version, serialized, {
      message: `${sidecar.source ?? "skila"} ${fm.name} v${sidecar.version}`,
      status: sidecar.status,
      sidecar
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "E_ADAPTER_MISMATCH") throw err;
  }
  return file;
}

// Synchronous live-tree-only write helper, used by paths that must not await
// (e.g. validation prefetch). Does NOT record history.
export function writeSkillFileLiveOnly(
  dir: string,
  fm: SkillFrontmatter,
  body: string,
  sidecar?: SkilaMetadata
): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  atomicWriteFileSync(file, serializeSkillFile(fm, body));
  if (sidecar) writeSidecar(file, sidecar);
  return file;
}

// Re-export for callers that previously imported via this module.
export { readSidecar };
