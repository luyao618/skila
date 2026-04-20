import { withLock, readFeedbackSync } from "../../feedback/store.js";
import { sendJson } from "../middleware/token.js";
export async function handleGetFeedback(req, res, name) {
    const data = await withLock(() => {
        const store = readFeedbackSync();
        return store[name] ?? null;
    });
    sendJson(res, 200, data);
}
//# sourceMappingURL=feedback.js.map