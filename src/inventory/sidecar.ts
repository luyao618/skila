// Sidecar I/O for `.skila.json` — bookkeeping that used to live in SKILL.md
// frontmatter. Plain JSON next to each SKILL.md so disk content stays clean.

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { SkilaMetadata, SkillStatus, SkilaSource } from "../types.js";
import { atomicWriteFileSync } from "../storage/atomic.js";

export const SIDECAR_FILENAME = ".skila.json";

export function sidecarPathFor(skillMdPath: string): string {
  return join(dirname(skillMdPath), SIDECAR_FILENAME);
}

export function defaultSkila(status: SkillStatus = "published"): SkilaMetadata {
  return {
    version: "0.0.0",
    status,
    parentVersion: null,
    revisionCount: 0,
    lastImprovedAt: "",
    changelog: [],
  };
}

/** Coerce arbitrary input (legacy YAML or JSON) into a SkilaMetadata. */
export function normalizeSkila(raw: unknown, fallbackStatus: SkillStatus = "published"): SkilaMetadata {
  const r = (raw ?? {}) as Record<string, unknown>;
  const d = defaultSkila(fallbackStatus);
  const status = (r.status as SkillStatus) ?? d.status;
  return {
    version: typeof r.version === "string" ? r.version : d.version,
    status,
    parentVersion: (r.parentVersion as string | null | undefined) ?? null,
    revisionCount: typeof r.revisionCount === "number" ? r.revisionCount : 0,
    lastImprovedAt: typeof r.lastImprovedAt === "string" ? r.lastImprovedAt : "",
    changelog: Array.isArray(r.changelog) ? (r.changelog as SkilaMetadata["changelog"]) : [],
    source: (r.source as SkilaSource | undefined) ?? undefined,
  };
}

export function readSidecarIfExists(skillMdPath: string): SkilaMetadata | undefined {
  const p = sidecarPathFor(skillMdPath);
  if (!existsSync(p)) return undefined;
  try {
    return normalizeSkila(JSON.parse(readFileSync(p, "utf8")));
  } catch {
    return undefined;
  }
}

export function readSidecar(skillMdPath: string, fallbackStatus: SkillStatus = "published"): SkilaMetadata {
  return readSidecarIfExists(skillMdPath) ?? defaultSkila(fallbackStatus);
}

export function writeSidecar(skillMdPath: string, meta: SkilaMetadata): void {
  atomicWriteFileSync(sidecarPathFor(skillMdPath), JSON.stringify(meta, null, 2) + "\n");
}

export function serializeSidecar(meta: SkilaMetadata): string {
  return JSON.stringify(meta, null, 2) + "\n";
}

function bumpPatch(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) return "0.0.1";
  return `${m[1]}.${m[2]}.${parseInt(m[3], 10) + 1}`;
}

/** Pure helper: bump patch and append a changelog entry. */
export function bumpAndAppend(
  meta: SkilaMetadata,
  change: string,
  source?: SkilaSource
): SkilaMetadata {
  const prev = meta.version || "0.0.0";
  const next = bumpPatch(prev);
  const date = new Date().toISOString();
  return {
    ...meta,
    version: next,
    parentVersion: prev,
    revisionCount: (meta.revisionCount ?? 0) + 1,
    lastImprovedAt: date,
    source: source ?? meta.source,
    changelog: [...(meta.changelog ?? []), { version: next, date, change }],
  };
}
