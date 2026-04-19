// Auto-promotion: floor (≥10 invocations OR ≥1 failure) → .staging-skila/.
// Never published. Triggered after feedback writes.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { statusDir, loadConfig } from "../config/config.js";
import { findSkill } from "../inventory/scanner.js";
import { readFeedbackSync } from "../feedback/store.js";
import { moveSkillDir } from "../commands/_lifecycle.js";

export interface AutoPromoteResult {
  promoted: boolean;
  reason: string;
  destination?: string;
}

export async function maybeAutoPromote(name: string): Promise<AutoPromoteResult> {
  const cfg = loadConfig();
  const fb = readFeedbackSync()[name];
  if (!fb) return { promoted: false, reason: "no feedback" };
  const meetsFloor = fb.usageCount >= cfg.promotionFloorInvocations || fb.failureCount >= cfg.promotionFloorFailures;
  if (!meetsFloor) return { promoted: false, reason: `floor not met (uses=${fb.usageCount}, fails=${fb.failureCount})` };

  const skill = findSkill(name);
  if (!skill) return { promoted: false, reason: "skill not in inventory" };
  // Auto-promotion only fires from draft → staging. Published skills are not re-staged.
  if (skill.status !== "draft") return { promoted: false, reason: `status=${skill.status}; auto-promote only acts on drafts` };

  const dest = join(statusDir("staging"), name);
  if (existsSync(dest)) return { promoted: false, reason: "already staged" };
  await moveSkillDir(skill, "staging");
  return { promoted: true, reason: "floor met", destination: dest };
}
