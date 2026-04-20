// GET /api/skills/:name/versions — list versions
// GET /api/skills/:name/diff?from=&to= — unified diff
import type { IncomingMessage, ServerResponse } from "node:http";
import { getAdapter } from "../../storage/index.js";
import { findSkill } from "../../inventory/scanner.js";
import { sendJson } from "../middleware/token.js";

export async function handleGetVersions(
  req: IncomingMessage,
  res: ServerResponse,
  name: string
): Promise<void> {
  const skill = findSkill(name);
  if (!skill) { sendJson(res, 404, { error: `skill not found: ${name}` }); return; }
  try {
    const adapter = await getAdapter();
    const versions = await adapter.listVersions(name);
    sendJson(res, 200, versions);
  } catch (e: any) {
    sendJson(res, 500, { error: "storage failure" });
  }
}

export async function handleGetDiff(
  req: IncomingMessage,
  res: ServerResponse,
  name: string,
  from: string,
  to: string
): Promise<void> {
  if (!from || !to) { sendJson(res, 400, { error: "from and to query params required" }); return; }
  try {
    const adapter = await getAdapter();
    const diff = await adapter.diff(name, from, to);
    sendJson(res, 200, { diff });
  } catch (e: any) {
    sendJson(res, 422, { error: e.message });
  }
}
