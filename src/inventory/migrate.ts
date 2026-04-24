// One-time migration: for every skill under SKILA_SKILLS_ROOT, move the legacy
// `skila:` frontmatter block into a sidecar `.skila.json` and rewrite SKILL.md
// without it. Idempotent: skips skills whose sidecar already exists.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { skillsRoot, statusDir } from "../config/config.js";
import { parseSkillFile, serializeSkillFile } from "../inventory/frontmatter.js";
import { sidecarPathFor, writeSidecar, normalizeSkila } from "../inventory/sidecar.js";
import { atomicWriteFileSync } from "../storage/atomic.js";
import type { SkillStatus } from "../types.js";

const ALL_STATUSES: SkillStatus[] = ["draft", "staging", "published", "archived"];

export interface MigrateResult {
  migrated: number;
  skipped: number;
  errors: { path: string; error: string }[];
}

function collectSkillDirs(): Array<{ dir: string; status: SkillStatus }> {
  const out: Array<{ dir: string; status: SkillStatus }> = [];
  for (const status of ALL_STATUSES) {
    const root = statusDir(status);
    if (!existsSync(root)) continue;
    let entries: string[];
    try { entries = readdirSync(root); } catch { continue; }
    for (const entry of entries) {
      if (status === "published" && entry.startsWith(".")) continue;
      const dir = join(root, entry);
      let st;
      try { st = statSync(dir); } catch { continue; }
      if (!st.isDirectory()) continue;
      if (!existsSync(join(dir, "SKILL.md"))) continue;
      out.push({ dir, status });
    }
  }
  return out;
}

export function runMigrateSidecar(): MigrateResult {
  const result: MigrateResult = { migrated: 0, skipped: 0, errors: [] };
  // Touch skillsRoot() just so any env-based path is consistent.
  void skillsRoot();

  for (const { dir, status } of collectSkillDirs()) {
    const skillFile = join(dir, "SKILL.md");
    const sidecarFile = sidecarPathFor(skillFile);
    if (existsSync(sidecarFile)) { result.skipped++; continue; }
    try {
      const raw = readFileSync(skillFile, "utf8");
      const parsed = parseSkillFile(raw);
      // If there's no legacy skila block, we still write a sidecar so the
      // on-disk layout is consistent going forward — status comes from the
      // directory the file lives in.
      const sidecar = parsed.legacySkila
        ? normalizeSkila({ ...parsed.legacySkila, status })
        : normalizeSkila({ status });
      sidecar.status = status;
      writeSidecar(skillFile, sidecar);

      if (parsed.legacySkila) {
        // Rewrite SKILL.md without the skila block (serializer strips it).
        const cleaned = serializeSkillFile(parsed.frontmatter, parsed.body);
        if (cleaned !== raw) {
          atomicWriteFileSync(skillFile, cleaned);
        }
      }
      result.migrated++;
    } catch (err) {
      result.errors.push({ path: skillFile, error: (err as Error).message });
    }
  }
  return result;
}
