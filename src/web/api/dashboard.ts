// GET /api/dashboard — aggregated stats
import type { IncomingMessage, ServerResponse } from "node:http";
import { scanInventory } from "../../inventory/scanner.js";
import { readFeedbackSync } from "../../feedback/store.js";
import { sendJson } from "../middleware/token.js";
import { moveSkillDir } from "../../commands/_lifecycle.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Auto-archive: if usageCount < 2 and last activity > 7 days ago, demote to archived.
 * "Last activity" = lastUsedAt (from feedback) or skill creation date (first changelog entry).
 * Only applies to draft/staging skills — published skills are not auto-archived.
 */
async function maybeAutoArchive(skills: ReturnType<typeof scanInventory>, feedback: ReturnType<typeof readFeedbackSync>): Promise<string[]> {
  const now = Date.now();
  const archived: string[] = [];
  for (const skill of skills) {
    if (skill.status === "archived" || skill.status === "published") continue;
    const fb = feedback[skill.name];
    const usageCount = fb?.usageCount ?? 0;
    if (usageCount >= 2) continue;

    // Determine last activity time
    const lastUsedAt = fb?.lastUsedAt ? new Date(fb.lastUsedAt).getTime() : 0;
    const createdAt = skill.skila?.changelog?.[0]?.date
      ? new Date(skill.skila.changelog[0].date).getTime()
      : 0;
    const lastActivity = Math.max(lastUsedAt, createdAt);

    if (lastActivity === 0) continue; // no date info, skip
    if (now - lastActivity > SEVEN_DAYS_MS) {
      try {
        await moveSkillDir(skill, "archived");
        archived.push(skill.name);
      } catch { /* best-effort */ }
    }
  }
  return archived;
}

export async function handleGetDashboard(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const skills = scanInventory();
  const feedback = readFeedbackSync();

  // Auto-archive stale skills before computing stats
  const autoArchived = await maybeAutoArchive(skills, feedback);
  // Re-scan if any skills were archived so stats reflect the new state
  const currentSkills = autoArchived.length > 0 ? scanInventory() : skills;

  const counts: Record<string, number> = { draft: 0, staging: 0, published: 0, archived: 0 };
  for (const s of currentSkills) counts[s.status] = (counts[s.status] ?? 0) + 1;
  const feedbackEntries = Object.entries(feedback);
  const totalUsage = feedbackEntries.reduce((sum, [, e]) => sum + e.usageCount, 0);
  const avgSuccessRate = feedbackEntries.length > 0
    ? feedbackEntries.reduce((sum, [, e]) => sum + e.successRate, 0) / feedbackEntries.length
    : null;

  const lowSuccess = feedbackEntries
    .filter(([, e]) => e.successRate < 0.5 && e.usageCount >= 3)
    .map(([name]) => name);

  const stagingBacklog = currentSkills.filter(s => s.status === "staging").map(s => s.name);

  // Per-skill aggregated stats for dashboard
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  let activeSkills = 0;
  let globalLastUsedAt: string | null = null;

  const skillStats = currentSkills.map(s => {
    const fb = feedback[s.name];
    const usageCount = fb?.usageCount ?? 0;
    const successRate = fb?.successRate ?? null;
    const failureCount = fb?.failureCount ?? 0;
    const lastUsedAt = fb?.lastUsedAt ?? null;

    if (lastUsedAt && new Date(lastUsedAt).getTime() > sevenDaysAgo) {
      activeSkills++;
    }
    if (lastUsedAt && (!globalLastUsedAt || lastUsedAt > globalLastUsedAt)) {
      globalLastUsedAt = lastUsedAt;
    }

    return {
      name: s.name,
      status: s.status,
      version: s.skila?.version ?? "0.0.0",
      description: s.frontmatter?.description ?? "",
      usageCount,
      successRate,
      failureCount,
      lastUsedAt,
      revisionCount: s.skila?.revisionCount ?? 0,
      lastImprovedAt: s.skila?.lastImprovedAt ?? null,
    };
  });

  // Daily trend data: created, updated, invoked per day
  const dailyCreated: Record<string, number> = {};
  const dailyUpdated: Record<string, number> = {};
  const dailyInvoked: Record<string, number> = {};

  for (const s of currentSkills) {
    const cl = s.skila?.changelog ?? [];
    for (let i = 0; i < cl.length; i++) {
      const day = (cl[i].date ?? "").slice(0, 10);
      if (!day) continue;
      if (i === 0) dailyCreated[day] = (dailyCreated[day] ?? 0) + 1;
      else dailyUpdated[day] = (dailyUpdated[day] ?? 0) + 1;
    }
  }

  for (const [, fb] of feedbackEntries) {
    for (const inv of fb.invocations ?? []) {
      const day = (inv.ts ?? "").slice(0, 10);
      if (day) dailyInvoked[day] = (dailyInvoked[day] ?? 0) + 1;
    }
  }

  sendJson(res, 200, {
    counts,
    totalSkills: currentSkills.length,
    totalUsage,
    avgSuccessRate,
    lowSuccess,
    stagingBacklog,
    stagingCount: stagingBacklog.length,
    skillStats,
    activeSkills,
    lastUsedAt: globalLastUsedAt,
    dailyCreated,
    dailyUpdated,
    dailyInvoked,
    autoArchived,
  });
}
