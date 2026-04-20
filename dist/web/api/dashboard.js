import { scanInventory } from "../../inventory/scanner.js";
import { readFeedbackSync } from "../../feedback/store.js";
import { sendJson } from "../middleware/token.js";
export async function handleGetDashboard(req, res) {
    const skills = scanInventory();
    const counts = { draft: 0, staging: 0, published: 0, archived: 0, disabled: 0 };
    for (const s of skills)
        counts[s.status] = (counts[s.status] ?? 0) + 1;
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
    sendJson(res, 200, {
        counts,
        totalSkills: skills.length,
        totalUsage,
        avgSuccessRate,
        lowSuccess,
        stagingBacklog,
        stagingCount: stagingBacklog.length,
    });
}
//# sourceMappingURL=dashboard.js.map