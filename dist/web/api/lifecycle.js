import { sendJson } from "../middleware/token.js";
export async function handleLifecycle(req, res, name, action, query) {
    try {
        switch (action) {
            case "promote": {
                const { runPromote } = await import("../../commands/promote.js");
                sendJson(res, 200, await runPromote(name));
                break;
            }
            case "graduate": {
                const { runGraduate } = await import("../../commands/graduate.js");
                sendJson(res, 200, await runGraduate(name));
                break;
            }
            case "reject": {
                const { runReject } = await import("../../commands/reject.js");
                sendJson(res, 200, await runReject(name));
                break;
            }
            case "archive": {
                const { runArchive } = await import("../../commands/archive.js");
                sendJson(res, 200, await runArchive(name));
                break;
            }
            case "disable": {
                const { runDisable } = await import("../../commands/disable.js");
                sendJson(res, 200, await runDisable(name));
                break;
            }
            case "reactivate": {
                const { runReactivate } = await import("../../commands/reactivate.js");
                sendJson(res, 200, await runReactivate(name));
                break;
            }
            case "rollback": {
                const { runRollback } = await import("../../commands/rollback.js");
                const to = query.get("to") ?? "";
                if (!to) {
                    sendJson(res, 400, { error: "rollback requires ?to=v0.X.Y" });
                    return;
                }
                sendJson(res, 200, await runRollback(name, to));
                break;
            }
            default:
                sendJson(res, 404, { error: `unknown lifecycle action: ${action}` });
        }
    }
    catch (e) {
        sendJson(res, 422, { error: e.message });
    }
}
//# sourceMappingURL=lifecycle.js.map