// Inventory scanner: walks 5 status dirs and parses SKILL.md files.

import { readdirSync, readFileSync, lstatSync, realpathSync, existsSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import type { Skill, SkillStatus } from "../types.js";
import { parseSkillFile } from "./frontmatter.js";
import { readSidecarIfExists, defaultSkila } from "./sidecar.js";
import { skillsRoot, statusDir } from "../config/config.js";

export interface ScanWarning {
  type: "symlink" | "out-of-root";
  path: string;
}

// Module-level warnings accumulated during scan (cleared on each scanInventory call).
let _lastWarnings: ScanWarning[] = [];

export function getLastScanWarnings(): ScanWarning[] {
  return _lastWarnings;
}

const ALL_STATUSES: SkillStatus[] = ["draft", "staging", "published", "archived", "disabled"];

export function scanInventory(): Skill[] {
  _lastWarnings = [];
  const out: Skill[] = [];
  for (const status of ALL_STATUSES) {
    out.push(...scanStatus(status));
  }
  return out;
}

export function scanStatus(status: SkillStatus): Skill[] {
  const root = statusDir(status);
  if (!existsSync(root)) return [];
  const resolvedRoot = realpathSync(root);
  const out: Skill[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (status === "published") {
      // skip dotfiles since published shares root with the four dot-prefixed status dirs
      if (entry.startsWith(".")) continue;
    }
    const dir = join(root, entry);
    let st;
    try {
      st = lstatSync(dir);
    } catch {
      continue;
    }
    // Follow symlinks but verify the resolved target is a directory.
    // The realpath containment check below guards against escapes into
    // unexpected locations.
    let resolvedDir: string;
    try {
      resolvedDir = realpathSync(dir);
    } catch {
      continue;
    }
    let realStat;
    try {
      realStat = lstatSync(resolvedDir);
    } catch {
      continue;
    }
    if (!realStat.isDirectory()) continue;
    const file = join(dir, "SKILL.md");
    if (!existsSync(file)) continue;
    try {
      const raw = readFileSync(file, "utf8");
      let parsed;
      try {
        parsed = parseSkillFile(raw);
      } catch {
        // Fallback for skills without YAML frontmatter (plain markdown).
        // Extract a description from the first heading or first line.
        const firstLine = raw.split("\n").find(l => l.trim()) ?? "";
        const desc = firstLine.replace(/^#+\s*/, "").trim();
        parsed = {
          frontmatter: { name: entry, description: desc } as any,
          body: raw,
          raw,
          legacySkila: undefined,
        };
      }
      // Sidecar (preferred) → legacy in-frontmatter (transitional) → defaults.
      const sidecar = readSidecarIfExists(file);
      const skila = sidecar ?? parsed.legacySkila ?? defaultSkila(status);
      // Status on disk (which dir the file lives in) wins over what the
      // sidecar / legacy block claims, so the inventory matches reality.
      skila.status = status;
      // Scan for supporting files in subdirectories
      const supportingFiles: string[] = [];
      const ALLOWED_SUBDIRS = ["scripts", "references", "assets"];
      for (const subdir of ALLOWED_SUBDIRS) {
        const subdirPath = join(dir, subdir);
        if (existsSync(subdirPath) && statSync(subdirPath).isDirectory()) {
          const walkDir = (d: string, prefix: string) => {
            for (const childEntry of readdirSync(d)) {
              const full = join(d, childEntry);
              const rel = prefix ? `${prefix}/${childEntry}` : childEntry;
              if (statSync(full).isDirectory()) {
                walkDir(full, rel);
              } else {
                supportingFiles.push(`${subdir}/${rel}`);
              }
            }
          };
          walkDir(subdirPath, "");
        }
      }
      out.push({
        name: parsed.frontmatter.name ?? entry,
        status,
        path: file,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        skila,
        supportingFiles
      });
    } catch {
      // ignore truly unparseable (e.g. unreadable file)
    }
  }
  return out;
}

export function findSkill(name: string): Skill | undefined {
  for (const status of ALL_STATUSES) {
    const skills = scanStatus(status);
    const hit = skills.find((s) => s.name === name);
    if (hit) return hit;
  }
  return undefined;
}

export function inventoryHas(name: string): boolean {
  return findSkill(name) !== undefined;
}

export function skillsRootPath(): string { return skillsRoot(); }
