// Inventory scanner: walks 5 status dirs and parses SKILL.md files.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Skill, SkillStatus } from "../types.js";
import { parseSkillFile } from "./frontmatter.js";
import { skillsRoot, statusDir } from "../config/config.js";

const ALL_STATUSES: SkillStatus[] = ["draft", "staging", "published", "archived", "disabled"];

export function scanInventory(): Skill[] {
  const out: Skill[] = [];
  for (const status of ALL_STATUSES) {
    out.push(...scanStatus(status));
  }
  return out;
}

export function scanStatus(status: SkillStatus): Skill[] {
  const root = statusDir(status);
  if (!existsSync(root)) return [];
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
      st = statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const file = join(dir, "SKILL.md");
    if (!existsSync(file)) continue;
    try {
      const raw = readFileSync(file, "utf8");
      const parsed = parseSkillFile(raw);
      out.push({
        name: parsed.frontmatter.name ?? entry,
        status,
        path: file,
        frontmatter: parsed.frontmatter,
        body: parsed.body
      });
    } catch {
      // ignore unparseable
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
