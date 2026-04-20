import { getAdapter } from "../../storage/index.js";
import { findSkill } from "../../inventory/scanner.js";
import { sendJson } from "../middleware/token.js";
export async function handleGetVersions(req, res, name) {
    const skill = findSkill(name);
    if (!skill) {
        sendJson(res, 404, { error: `skill not found: ${name}` });
        return;
    }
    try {
        const adapter = await getAdapter();
        const versions = await adapter.listVersions(name);
        sendJson(res, 200, versions);
    }
    catch {
        sendJson(res, 200, []);
    }
}
export async function handleGetDiff(req, res, name, from, to) {
    if (!from || !to) {
        sendJson(res, 400, { error: "from and to query params required" });
        return;
    }
    try {
        const adapter = await getAdapter();
        const diff = await adapter.diff(name, from, to);
        sendJson(res, 200, { diff });
    }
    catch (e) {
        sendJson(res, 422, { error: e.message });
    }
}
//# sourceMappingURL=versions.js.map