// GET /api/skills/:name/feedback — read feedback.json slice under lock
import type { IncomingMessage, ServerResponse } from "node:http";
import { withLock, readFeedbackSync } from "../../feedback/store.js";
import { sendJson } from "../middleware/token.js";

export async function handleGetFeedback(
  req: IncomingMessage,
  res: ServerResponse,
  name: string
): Promise<void> {
  const data = await withLock(() => {
    const store = readFeedbackSync();
    return store[name] ?? null;
  });
  sendJson(res, 200, data);
}
