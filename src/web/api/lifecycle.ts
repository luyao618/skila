// POST /api/skills/:name/{promote,graduate,reject,archive,reactivate,rollback,move}
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../middleware/token.js";

const VALID_STATUSES = new Set(["draft", "staging", "published", "archived"]);

export async function handleLifecycle(
  req: IncomingMessage,
  res: ServerResponse,
  name: string,
  action: string,
  query: URLSearchParams
): Promise<void> {
  try {
    switch (action) {
      case "promote": {
        const { runPromote } = await import("../../commands/promote.js");
        sendJson(res, 200, await runPromote(name)); break;
      }
      case "graduate": {
        const { runGraduate } = await import("../../commands/graduate.js");
        sendJson(res, 200, await runGraduate(name)); break;
      }
      case "reject": {
        const { runReject } = await import("../../commands/reject.js");
        sendJson(res, 200, await runReject(name)); break;
      }
      case "archive": {
        const { runArchive } = await import("../../commands/archive.js");
        sendJson(res, 200, await runArchive(name)); break;
      }
      case "reactivate": {
        const { runReactivate } = await import("../../commands/reactivate.js");
        sendJson(res, 200, await runReactivate(name)); break;
      }
      case "rollback": {
        const { runRollback } = await import("../../commands/rollback.js");
        const to = query.get("to") ?? "";
        if (!to) { sendJson(res, 400, { error: "rollback requires ?to=v0.X.Y" }); return; }
        sendJson(res, 200, await runRollback(name, to)); break;
      }
      case "move": {
        const to = query.get("to") ?? "";
        if (!to || !VALID_STATUSES.has(to)) { sendJson(res, 400, { error: "move requires ?to=draft|staging|published|archived" }); return; }
        const { findSkill } = await import("../../inventory/scanner.js");
        const { moveSkillDir } = await import("../../commands/_lifecycle.js");
        const skill = findSkill(name);
        if (!skill) { sendJson(res, 404, { error: `skill not found: ${name}` }); return; }
        if (skill.status === to) { sendJson(res, 200, { destination: skill.path, noop: true }); return; }
        const destination = await moveSkillDir(skill, to as any);
        sendJson(res, 200, { destination }); break;
      }
      default:
        sendJson(res, 404, { error: `unknown lifecycle action: ${action}` });
    }
  } catch (e: any) {
    sendJson(res, 422, { error: e.message });
  }
}
