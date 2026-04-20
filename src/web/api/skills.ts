// GET /api/skills — list all skills across 5 status buckets
// GET /api/skills/:name — full skill details
// PUT /api/skills/:name — save SKILL.md edit
// POST /api/skills/:name/feedback — manual feedback record

import { existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { scanInventory, findSkill } from "../../inventory/scanner.js";
import { validateSkillContent } from "../../validate/validate.js";
import { atomicWriteFileSync } from "../../storage/atomic.js";
import { getAdapter } from "../../storage/index.js";
import { incrementUsage } from "../../feedback/store.js";
import { sendJson } from "../middleware/token.js";
import { bumpAndAppend, writeSidecar } from "../../inventory/sidecar.js";
import type { Skill } from "../../types.js";
import { MAX_BODY_BYTES } from "../server.js";

/**
 * FIX-H13: bounded body reader. Throws SkilaBodyTooLarge if request exceeds
 * MAX_BODY_BYTES. Caller MUST handle and return 413.
 */
async function readBoundedBody(req: IncomingMessage): Promise<string | { tooLarge: true; limit: number }> {
  let body = "";
  let received = 0;
  for await (const chunk of req) {
    received += (chunk as Buffer).length;
    if (received > MAX_BODY_BYTES) return { tooLarge: true, limit: MAX_BODY_BYTES };
    body += chunk;
  }
  return body;
}

function skillSummary(s: Skill) {
  const skila = s.skila;
  return {
    name: s.name,
    status: s.status,
    version: skila.version || "0.0.0",
    description: s.frontmatter.description ?? "",
    revisionCount: skila.revisionCount ?? 0,
    lastImprovedAt: skila.lastImprovedAt || null,
    source: skila.source ?? "unknown",
    parentVersion: skila.parentVersion ?? null,
    warnings: (s.frontmatter as any)._warnings ?? [],
  };
}

function listDirFiles(dir: string, sub: string): string[] {
  const d = join(dir, sub);
  if (!existsSync(d)) return [];
  try {
    return readdirSync(d)
      .filter((f) => !statSync(join(d, f)).isDirectory())
      .map((f) => `${sub}/${f}`);
  } catch {
    return [];
  }
}

export async function handleGetSkills(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const skills = scanInventory().map(skillSummary);
  sendJson(res, 200, skills);
}

export async function handleGetSkill(req: IncomingMessage, res: ServerResponse, name: string): Promise<void> {
  const skill = findSkill(name);
  if (!skill) { sendJson(res, 404, { error: `skill not found: ${name}` }); return; }
  const dir = dirname(skill.path);
  const scripts = listDirFiles(dir, "scripts");
  const references = listDirFiles(dir, "references");
  const assets = listDirFiles(dir, "assets");
  // Send SKILL.md as-is — already clean (no skila block). The editor
  // round-trips disk bytes exactly without any transparent re-injection.
  const fullContent = readFileSync(skill.path, "utf8");
  sendJson(res, 200, {
    ...skillSummary(skill),
    body: fullContent,
    rawContent: fullContent,
    scripts,
    references,
    assets,
    mtime: statSync(skill.path).mtime.toISOString(),
  });
}

export async function handlePutSkill(
  req: IncomingMessage,
  res: ServerResponse,
  name: string
): Promise<void> {
  const bodyOrLimit = await readBoundedBody(req);
  if (typeof bodyOrLimit !== "string") {
    sendJson(res, 413, { error: `request body exceeds ${bodyOrLimit.limit} byte limit` });
    return;
  }
  const body = bodyOrLimit;
  let payload: { content: string; mtime?: string };
  try {
    payload = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" }); return;
  }
  const { content } = payload;
  if (typeof content !== "string") { sendJson(res, 400, { error: "body.content must be a string" }); return; }

  // FIX-H16: mtime is required for optimistic concurrency
  if (!payload.mtime) { sendJson(res, 400, { error: "mtime required" }); return; }

  // Validate just the SKILL.md (name + description + dir match).
  try {
    validateSkillContent(content, { expectedDirName: name });
  } catch (e: any) {
    sendJson(res, 422, { error: "validation failed", errors: e.errors ?? [e.message] }); return;
  }

  // mtime check (optimistic concurrency) — mtime is required (FIX-H16)
  const skill = findSkill(name);
  if (!skill) { sendJson(res, 404, { error: `skill not found: ${name}` }); return; }
  const diskMtime = statSync(skill.path).mtime.toISOString();
  if (diskMtime !== payload.mtime) {
    sendJson(res, 409, { error: "conflict: skill was modified since last read", diskMtime }); return;
  }

  // Bump sidecar and record a changelog entry. Disk SKILL.md = user bytes.
  const nextSidecar = bumpAndAppend(
    skill.skila,
    `web edit (was v${skill.skila.version || "0.0.0"})`,
    "user-edit-via-web"
  );
  // Preserve on-disk status (don't let stale sidecar override reality).
  nextSidecar.status = skill.status;

  // Write SKILL.md exactly as the user provided it + updated sidecar.
  atomicWriteFileSync(skill.path, content);
  writeSidecar(skill.path, nextSidecar);

  try {
    const adapter = await getAdapter();
    await adapter.writeSkill(name, nextSidecar.version, content, {
      message: `web-edit ${name} v${nextSidecar.version}`,
      status: nextSidecar.status,
      sidecar: nextSidecar,
    });
  } catch { /* best effort */ }

  sendJson(res, 200, {
    ok: true,
    version: nextSidecar.version,
    mtime: statSync(skill.path).mtime.toISOString(),
  });
}

export async function handlePostFeedback(
  req: IncomingMessage,
  res: ServerResponse,
  name: string
): Promise<void> {
  const bodyOrLimit = await readBoundedBody(req);
  if (typeof bodyOrLimit !== "string") {
    sendJson(res, 413, { error: `request body exceeds ${bodyOrLimit.limit} byte limit` });
    return;
  }
  const rawBody = bodyOrLimit;
  let payload: { outcome?: string; session?: string } = {};
  try { if (rawBody) payload = JSON.parse(rawBody); } catch { /* ignore */ }
  const outcome = (payload.outcome as "success" | "failure" | "unknown") ?? "unknown";
  await incrementUsage(name, outcome);
  sendJson(res, 200, { ok: true });
}
