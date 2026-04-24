// GET /api/dashboard — aggregated stats
import type { IncomingMessage, ServerResponse } from "node:http";
import { scanInventory } from "../../inventory/scanner.js";
import { readFeedbackSync } from "../../feedback/store.js";
import { sendJson } from "../middleware/token.js";

export async function handleGetDashboard(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const skills = scanInventory();
  const counts: Record<string, number> = { draft: 0, staging: 0, published: 0, archived: 0 };
  for (const s of skills) counts[s.status] = (counts[s.status] ?? 0) + 1;

  const feedback = readFeedbackSync();
  const feedbackEntries = Object.entries(feedback);
  const totalUsage = feedbackEntries.reduce((sum, [, e]) => sum + e.usageCount, 0);
  const avgSuccessRate = feedbackEntries.length > 0
    ? feedbackEntries.reduce((sum, [, e]) => sum + e.successRate, 0) / feedbackEntries.length
    : null;

  const lowSuccess = feedbackEntries
    .filter(([, e]) => e.successRate < 0.5 && e.usageCount >= 3)
    .map(([name]) => name);

  const stagingBacklog = skills.filter(s => s.status === "staging").map(s => s.name);

  // Per-skill aggregated stats for dashboard
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  let activeSkills = 0;
  let globalLastUsedAt: string | null = null;

  const skillStats = skills.map(s => {
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

  for (const s of skills) {
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
    totalSkills: skills.length,
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
  });
}
