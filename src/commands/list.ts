// CLI: skila list [--status ...].
import { scanInventory } from "../inventory/scanner.js";
import type { SkillStatus } from "../types.js";

export function runList(filter?: SkillStatus): { name: string; status: SkillStatus; version: string }[] {
  const inv = scanInventory();
  const filtered = filter ? inv.filter((s) => s.status === filter) : inv;
  return filtered.map((s) => ({
    name: s.name,
    status: s.status,
    version: s.skila.version || "?"
  }));
}
