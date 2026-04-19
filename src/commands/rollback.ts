// rollback: creates a new current version bytes-equal old; bumps revisionCount;
// appends changelog. Phase 4: historical bytes are read via the StorageAdapter
// (git or flat) when possible; falls back to the on-disk versions/<name>/ tree
// for legacy snapshots.

import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { findSkill } from "../inventory/scanner.js";
import { ensureSkilaHome } from "../config/config.js";
import { atomicWriteFileSync } from "../storage/atomic.js";
import { parseSkillFile, serializeSkillFile } from "../inventory/frontmatter.js";
import { appendChangelog, bumpVersion } from "./_lifecycle.js";
import { getAdapter } from "../storage/index.js";

export async function runRollback(name: string, toVersion: string): Promise<{ newVersion: string; path: string }> {
  const skill = findSkill(name);
  if (!skill) throw new Error(`rollback: skill not found: ${name}`);

  // Resolve historical bytes — adapter first, then legacy versions/ tree.
  let histRaw: string | undefined;
  try {
    const adapter = await getAdapter();
    try {
      histRaw = await adapter.getVersion(name, toVersion);
    } catch { /* fall through to legacy */ }
  } catch { /* adapter unavailable */ }

  if (!histRaw) {
    const home = ensureSkilaHome();
    const histFile = join(home, "versions", name, `v${toVersion}`, "SKILL.md");
    if (!existsSync(histFile)) throw new Error(`rollback: historical version not found: v${toVersion}`);
    histRaw = readFileSync(histFile, "utf8");
  }

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
  const serialized = serializeSkillFile(fm, histParsed.body);
  atomicWriteFileSync(skill.path, serialized);
  try {
    const adapter = await getAdapter();
    await adapter.writeSkill(name, newVersion, serialized, {
      message: `rollback ${name} to v${toVersion}`,
      status: skill.status
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "E_ADAPTER_MISMATCH") throw err;
  }
  return { newVersion, path: skill.path };
}

// Snapshot helper used by other commands to record version history (legacy).
export function snapshotVersion(name: string, version: string, raw: string): string {
  const home = ensureSkilaHome();
  const dir = join(home, "versions", name, `v${version}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  atomicWriteFileSync(file, raw);
  return file;
}
