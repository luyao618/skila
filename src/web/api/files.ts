// GET /api/skills/:name/file?path=scripts/foo.ts — read individual supporting file.
//
// FIX-C7: harden against path traversal and arbitrary-file disclosure.
//   1. realpathSync both root and target → defeats symlink escape
//   2. lstatSync rejects symlinks within the resolved chain
//   3. Token-gate the endpoint (was previously open)
//   4. File-size cap (4 MiB) defeats /dev/zero hangs and OOM
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, normalize, dirname, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { findSkill } from "../../inventory/scanner.js";
import { sendJson, validateToken } from "../middleware/token.js";

const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MiB

export async function handleGetFile(
  req: IncomingMessage,
  res: ServerResponse,
  name: string,
  filePath: string,
  serverToken: string
): Promise<void> {
  // FIX-C7 (4): require auth even for reads; supporting files may contain secrets.
  if (!validateToken(req, res, serverToken)) return;

  const skill = findSkill(name);
  if (!skill) { sendJson(res, 404, { error: `skill not found: ${name}` }); return; }

  // String-level pre-check before any FS access
  const normalized = normalize(filePath).replace(/^(\.\.\/|\/)+/, "");
  if (!normalized || normalized.includes("..")) { sendJson(res, 400, { error: "path traversal not allowed" }); return; }

  const skillDir = dirname(skill.path);
  const abs = join(skillDir, normalized);

  if (!existsSync(abs)) { sendJson(res, 404, { error: `file not found: ${normalized}` }); return; }

  // FIX-C7 (2): reject symlinks at the leaf so attackers cannot follow into outside files.
  let leafStat;
  try { leafStat = lstatSync(abs); } catch { sendJson(res, 404, { error: "file not found" }); return; }
  if (leafStat.isSymbolicLink()) { sendJson(res, 403, { error: "symlinks not allowed" }); return; }
  if (!leafStat.isFile()) { sendJson(res, 400, { error: "not a regular file" }); return; }

  // FIX-C7 (1): realpath both sides; the resolved leaf must remain inside the resolved skill dir.
  let realLeaf: string;
  let realRoot: string;
  try {
    realLeaf = realpathSync(abs);
    realRoot = realpathSync(skillDir);
  } catch {
    sendJson(res, 404, { error: "file not found" }); return;
  }
  const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realLeaf !== realRoot && !realLeaf.startsWith(rootWithSep)) {
    sendJson(res, 403, { error: "path outside skill dir" }); return;
  }

  // FIX-C7 (4): cap size to defeat /dev/zero and similar.
  const sz = statSync(realLeaf).size;
  if (sz > MAX_FILE_BYTES) { sendJson(res, 413, { error: `file exceeds ${MAX_FILE_BYTES} byte cap`, size: sz }); return; }

  const content = readFileSync(realLeaf, "utf8");
  sendJson(res, 200, { path: normalized, content });
}
