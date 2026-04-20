// skila web server (AC13): node:http, 127.0.0.1:7777, auto-increment, SIGINT clean exit.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { URL } from "node:url";
import { generateToken, getTokenFromCookie, setTokenCookie, validateToken, sendJson } from "./middleware/token.js";

// API handlers
import { handleGetSkills, handleGetSkill, handlePutSkill, handlePostFeedback } from "./api/skills.js";
import { handleGetFile, handlePutFile } from "./api/files.js";
import { handleGetVersions, handleGetDiff } from "./api/versions.js";
import { handleLifecycle } from "./api/lifecycle.js";
import { handleGetFeedback } from "./api/feedback.js";
import { handleGetDashboard } from "./api/dashboard.js";
import { runMigrateSidecar } from "../inventory/migrate.js";

let sidecarMigrationRan = false;

export interface ServeOptions {
  port?: number;
  distDir?: string;
}

/** Resolve the dist/web directory — next to this file at runtime, or injected for tests. */
function defaultDistDir(): string {
  // At runtime dist/web/server.js → dist/web/
  const candidate = resolve(new URL(import.meta.url).pathname, "..");
  // If running from src (tsc watch), climb up one more
  if (candidate.endsWith("/src/web")) {
    return resolve(candidate, "../../dist/web");
  }
  return candidate;
}

export async function startServer(opts: ServeOptions = {}): Promise<{ port: number; close: () => Promise<void>; token: string }> {
  const distDir = opts.distDir ?? defaultDistDir();
  const serverToken = generateToken();
  const basePort = opts.port ?? 7777;

  // Auto-run sidecar migration once per process (idempotent). Ensures skills
  // that still have a `skila:` block in SKILL.md are split into the new
  // `.skila.json` sidecar layout before the API serves reads/writes.
  if (!sidecarMigrationRan) {
    sidecarMigrationRan = true;
    try {
      const r = runMigrateSidecar();
      if (r.migrated > 0) {
        process.stderr.write(`skila: migrated ${r.migrated} skills to sidecar layout\n`);
      }
      if (r.errors.length > 0) {
        process.stderr.write(`skila: sidecar migration had ${r.errors.length} errors\n`);
        for (const e of r.errors) {
          process.stderr.write(`  - ${e.path}: ${e.error}\n`);
        }
      }
    } catch (err) {
      process.stderr.write(`skila: sidecar migration failed: ${(err as Error).message}\n`);
    }
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await route(req, res, distDir, serverToken);
    } catch (e: any) {
      if (!res.headersSent) sendJson(res, 500, { error: e.message ?? "internal server error" });
    }
  });

  // Try ports until one binds
  const port = await new Promise<number>((resolve, reject) => {
    let attempt = basePort;
    const tryBind = () => {
      server.once("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "EADDRINUSE") {
          attempt++;
          tryBind();
        } else {
          reject(e);
        }
      });
      server.listen(attempt, "127.0.0.1", () => resolve(attempt));
    };
    tryBind();
  });

  const close = () => new Promise<void>((r, e) => server.close(err => err ? e(err) : r()));
  return { port, close, token: serverToken };
}

const LIFECYCLE_ACTIONS = new Set(["promote", "graduate", "reject", "archive", "disable", "reactivate", "rollback"]);

async function route(req: IncomingMessage, res: ServerResponse, distDir: string, serverToken: string): Promise<void> {
  const method = req.method ?? "GET";
  const rawUrl = req.url ?? "/";
  const url = new URL(rawUrl, "http://127.0.0.1");
  const path = url.pathname;

  // CORS — only allow same-origin (127.0.0.1)
  res.setHeader("X-Content-Type-Options", "nosniff");

  // ── Static assets ──────────────────────────────────────────────────────────
  if (method === "GET" && path === "/") {
    const indexPath = join(distDir, "index.html");
    if (!existsSync(indexPath)) {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("skila web UI not built yet — run npm run build");
      return;
    }
    let html = readFileSync(indexPath, "utf8");
    // Always (re)issue the token cookie on the index page so a browser holding
    // a stale cookie from a previous server run gets refreshed automatically.
    setTokenCookie(res, serverToken);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
    return;
  }

  if (method === "GET" && path.startsWith("/vendor/")) {
    serveStatic(res, distDir, path);
    return;
  }

  // ── API ────────────────────────────────────────────────────────────────────
  if (!path.startsWith("/api/")) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }

  // GET /api/dashboard
  if (method === "GET" && path === "/api/dashboard") {
    await handleGetDashboard(req, res); return;
  }

  // GET /api/skills
  if (method === "GET" && path === "/api/skills") {
    await handleGetSkills(req, res); return;
  }

  // /api/skills/:name/...
  const skillMatch = path.match(/^\/api\/skills\/([^/]+)(\/(.*))?$/);
  if (skillMatch) {
    const name = decodeURIComponent(skillMatch[1]);
    const sub = skillMatch[3] ?? "";

    // GET /api/skills/:name
    if (method === "GET" && sub === "") {
      await handleGetSkill(req, res, name); return;
    }
    // GET /api/skills/:name/file?path=...
    if (method === "GET" && sub === "file") {
      const filePath = url.searchParams.get("path") ?? "";
      await handleGetFile(req, res, name, filePath); return;
    }
    // PUT /api/skills/:name/file — write supporting (non-SKILL.md) text file
    if (method === "PUT" && sub === "file") {
      if (!validateToken(req, res, serverToken)) return;
      await handlePutFile(req, res, name); return;
    }
    // GET /api/skills/:name/versions
    if (method === "GET" && sub === "versions") {
      await handleGetVersions(req, res, name); return;
    }
    // GET /api/skills/:name/diff?from=&to=
    if (method === "GET" && sub === "diff") {
      await handleGetDiff(req, res, name, url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? ""); return;
    }
    // GET /api/skills/:name/feedback
    if (method === "GET" && sub === "feedback") {
      await handleGetFeedback(req, res, name); return;
    }
    // PUT /api/skills/:name — save SKILL.md
    if (method === "PUT" && sub === "") {
      if (!validateToken(req, res, serverToken)) return;
      await handlePutSkill(req, res, name); return;
    }
    // POST /api/skills/:name/feedback
    if (method === "POST" && sub === "feedback") {
      if (!validateToken(req, res, serverToken)) return;
      await handlePostFeedback(req, res, name); return;
    }
    // POST /api/skills/:name/{lifecycle action}
    if (method === "POST" && LIFECYCLE_ACTIONS.has(sub)) {
      if (!validateToken(req, res, serverToken)) return;
      await handleLifecycle(req, res, name, sub, url.searchParams); return;
    }
  }

  sendJson(res, 404, { error: `not found: ${method} ${path}` });
}

function serveStatic(res: ServerResponse, distDir: string, urlPath: string): void {
  const rel = urlPath.replace(/^\//, "").replace(/\.\./g, "");
  const abs = join(distDir, rel);
  if (!existsSync(abs)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }
  const mime = abs.endsWith(".js") ? "application/javascript" : abs.endsWith(".css") ? "text/css" : "application/octet-stream";
  const data = readFileSync(abs);
  res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=3600" });
  res.end(data);
}
