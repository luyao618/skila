// rollback: creates a new current version bytes-equal old; bumps revisionCount;
// appends changelog. Phase 4: historical bytes are read via the StorageAdapter
// (git or flat) when possible; falls back to the on-disk versions/<name>/ tree
// for legacy snapshots.

import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { findSkill } from "../inventory/scanner.js";
import { ensureSkilaHome } from "../config/config.js";
import { atomicWriteFileSync } from "../storage/atomic.js";
import { parseSkillFile, serializeSkillFile } from "../inventory/frontmatter.js";
import { appendChangelog, bumpVersion } from "./_lifecycle.js";
import { getAdapter } from "../storage/index.js";
import { readSidecarIfExists, writeSidecar, defaultSkila } from "../inventory/sidecar.js";
import type { SkilaMetadata } from "../types.js";

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

  // Reconstruct sidecar for the new version. We keep the live skill's full
  // changelog and append a rollback entry; body + frontmatter come from the
  // historical snapshot.
  const newVersion = bumpVersion(skill.skila.version, "minor");
  // Prefer the historical sidecar if we can locate it (versions/<name>/v<v>/.skila.json).
  const home = ensureSkilaHome();
  const histSidecarPath = join(home, "versions", name, `v${toVersion}`, ".skila.json");
  const histSidecar = existsSync(histSidecarPath)
    ? readSidecarIfExists(join(dirname(histSidecarPath), "SKILL.md"))
    : undefined;
  const baseSidecar = histSidecar ?? histParsed.legacySkila ?? defaultSkila(skill.status);

  const sidecar: SkilaMetadata = {
    ...baseSidecar,
    version: newVersion,
    status: skill.status,
    parentVersion: skill.skila.version,
    revisionCount: (skill.skila.revisionCount ?? 0) + 1,
    lastImprovedAt: new Date().toISOString(),
    source: "skila-rollback",
    changelog: [...(skill.skila.changelog ?? [])],
  };
  appendChangelog(sidecar, newVersion, `Rolled back to v${toVersion}`);

  const serialized = serializeSkillFile(histParsed.frontmatter, histParsed.body);
  atomicWriteFileSync(skill.path, serialized);
  writeSidecar(skill.path, sidecar);
  try {
    const adapter = await getAdapter();
    await adapter.writeSkill(name, newVersion, serialized, {
      message: `rollback ${name} to v${toVersion}`,
      status: skill.status,
      sidecar
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
