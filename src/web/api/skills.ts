// GET /api/skills — list all skills across 5 status buckets
// GET /api/skills/:name — full skill details
// PUT /api/skills/:name — save SKILL.md edit
// POST /api/skills/:name/feedback — manual feedback record

import { existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { scanInventory, findSkill } from "../../inventory/scanner.js";
import { validateSkillContent } from "../../validate/validate.js";
import { parseSkillFile, serializeSkillFile } from "../../inventory/frontmatter.js";
import { atomicWriteFileSync } from "../../storage/atomic.js";
import { getAdapter } from "../../storage/index.js";
import { incrementUsage } from "../../feedback/store.js";
import { sendJson } from "../middleware/token.js";

function skillSummary(s: ReturnType<typeof scanInventory>[number]) {
  const skila = s.frontmatter.skila ?? {};
  return {
    name: s.name,
    status: s.status,
    version: skila.version ?? "0.0.0",
    description: s.frontmatter.description ?? "",
    revisionCount: skila.revisionCount ?? 0,
    lastImprovedAt: skila.lastImprovedAt ?? null,
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
  sendJson(res, 200, {
    ...skillSummary(skill),
    body: skill.body,
    rawContent: skill.body,
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
  let body = "";
  for await (const chunk of req) body += chunk;
  let payload: { content: string; mtime?: string };
  try {
    payload = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" }); return;
  }
  const { content } = payload;
  if (typeof content !== "string") { sendJson(res, 400, { error: "body.content must be a string" }); return; }

  // Validate
  let fm;
  try {
    fm = validateSkillContent(content, { expectedDirName: name });
  } catch (e: any) {
    sendJson(res, 422, { error: "validation failed", errors: e.errors ?? [e.message] }); return;
  }

  // mtime check (optimistic concurrency)
  const skill = findSkill(name);
  if (!skill) { sendJson(res, 404, { error: `skill not found: ${name}` }); return; }
  if (payload.mtime) {
    const diskMtime = statSync(skill.path).mtime.toISOString();
    if (diskMtime !== payload.mtime) {
      sendJson(res, 409, { error: "conflict: skill was modified since last read", diskMtime }); return;
    }
  }

  // Patch source to web
  fm.skila.source = "user-edit-via-web";
  fm.skila.lastImprovedAt = new Date().toISOString();
  const serialized = serializeSkillFile(fm, parseSkillFile(content).body);
  atomicWriteFileSync(skill.path, serialized);
  try {
    const adapter = await getAdapter();
    await adapter.writeSkill(name, fm.skila.version, serialized, {
      message: `web-edit ${name} v${fm.skila.version}`,
      status: fm.skila.status,
    });
  } catch { /* best effort */ }

  sendJson(res, 200, { ok: true, version: fm.skila.version, mtime: statSync(skill.path).mtime.toISOString() });
}

export async function handlePostFeedback(
  req: IncomingMessage,
  res: ServerResponse,
  name: string
): Promise<void> {
  let rawBody = "";
  for await (const chunk of req) rawBody += chunk;
  let payload: { outcome?: string; session?: string } = {};
  try { if (rawBody) payload = JSON.parse(rawBody); } catch { /* ignore */ }
  const outcome = (payload.outcome as "success" | "failure" | "unknown") ?? "unknown";
  await incrementUsage(name, outcome);
  sendJson(res, 200, { ok: true });
}
