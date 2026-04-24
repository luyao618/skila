// Auto-promotion: floor (≥10 invocations OR ≥1 failure) → .staging-skila/.
// Never published. Triggered after feedback writes.

import { existsSync, mkdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { statusDir, loadConfig, ensureSkilaHome } from "../config/config.js";
import { findSkill } from "../inventory/scanner.js";
import { readFeedbackSync } from "../feedback/store.js";
import { moveSkillDir } from "../commands/_lifecycle.js";

export interface AutoPromoteResult {
  promoted: boolean;
  reason: string;
  destination?: string;
}

function promoteLockPath(name: string): string {
  return join(ensureSkilaHome(), `.promote-${name}.lock`);
}

async function acquirePromoteLock(lockPath: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      mkdirSync(lockPath, { recursive: false });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      if (Date.now() - start >= timeoutMs) {
        throw new Error(`promote lock acquire timeout for ${lockPath}`);
      }
      // small yield to allow other async ops to progress
      await new Promise((res) => setTimeout(res, 5 + Math.floor(Math.random() * 15)));
    }
  }
}

function releasePromoteLock(lockPath: string): void {
  try { rmdirSync(lockPath); } catch { /* best-effort */ }
}

export async function maybeAutoPromote(name: string): Promise<AutoPromoteResult> {
  const cfg = loadConfig();
  const fb = readFeedbackSync()[name];
  if (!fb) return { promoted: false, reason: "no feedback" };
  const meetsFloor = fb.usageCount >= cfg.promotionFloorInvocations || fb.failureCount >= cfg.promotionFloorFailures;
  if (!meetsFloor) return { promoted: false, reason: `floor not met (uses=${fb.usageCount}, fails=${fb.failureCount})` };

  // FIX-H3: acquire per-skill promote lock before any filesystem checks so
  // concurrent callers cannot both observe "not yet staged" and proceed.
  const lockPath = promoteLockPath(name);
  await acquirePromoteLock(lockPath, cfg.lockTimeoutMs * 10);
  try {
    // FIX-H3: re-check skill inventory and destination inside the critical
    // section to guard against TOCTOU races.
    const skill = findSkill(name);
    if (!skill) return { promoted: false, reason: "skill not in inventory" };
    // draft → staging (≥3 uses) or staging → published (≥10 uses)
    if (skill.status === "draft") {
      const dest = join(statusDir("staging"), name);
      if (existsSync(dest)) return { promoted: false, reason: "already staged" };
      await moveSkillDir(skill, "staging");
      return { promoted: true, reason: "floor met (draft→staging)", destination: dest };
    }

    if (skill.status === "staging" && fb.usageCount >= cfg.publishFloorInvocations) {
      const dest = join(statusDir("published"), name);
      if (existsSync(dest)) return { promoted: false, reason: "already published" };
      await moveSkillDir(skill, "published");
      return { promoted: true, reason: "floor met (staging→published)", destination: dest };
    }

    return { promoted: false, reason: `status=${skill.status}; no promotion rule matched` };
  } finally {
    releasePromoteLock(lockPath);
  }
}
