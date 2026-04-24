// skila web server (AC13): node:http, 127.0.0.1:7777, auto-increment, SIGINT clean exit.
//
// FIX-H17: validate Host + Origin to defeat DNS rebinding attacks.
// FIX-H13: enforce body-size cap and Content-Type check on PUT/POST.
// FIX-C7:  files endpoint now requires token (handleGetFile signature changed).
import { createServer } from "node:http";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { generateToken, setTokenCookie, validateToken, sendJson } from "./middleware/token.js";
// API handlers
import { handleGetSkills, handleGetSkill, handlePutSkill, handlePostFeedback } from "./api/skills.js";
import { handleGetFile, handlePutFile } from "./api/files.js";
import { handleGetVersions, handleGetDiff } from "./api/versions.js";
import { handleLifecycle } from "./api/lifecycle.js";
import { handleGetFeedback } from "./api/feedback.js";
import { handleGetDashboard } from "./api/dashboard.js";
import { handleTranslateSkill, handleGetTranslateSettings, handlePutTranslateSettings } from "./api/translate.js";
import { runMigrateSidecar } from "../inventory/migrate.js";
let sidecarMigrationRan = false;
// FIX-H13: body cap shared across PUT/POST handlers (1 MiB request body limit).
export const MAX_BODY_BYTES = 1 * 1024 * 1024;
/** Resolve the dist/web directory — next to this file at runtime, or injected for tests. */
function defaultDistDir() {
    // FIX-M3 candidate: use fileURLToPath instead of URL.pathname (Windows-safe)
    const here = fileURLToPath(import.meta.url);
    const candidate = resolve(here, "..");
    if (candidate.endsWith("/src/web") || candidate.endsWith("\\src\\web")) {
        return resolve(candidate, "../../dist/web");
    }
    return candidate;
}
export async function startServer(opts = {}) {
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
        }
        catch (err) {
            process.stderr.write(`skila: sidecar migration failed: ${err.message}\n`);
        }
    }
    const server = createServer(async (req, res) => {
        try {
            await route(req, res, distDir, serverToken);
        }
        catch (e) {
            if (!res.headersSent)
                sendJson(res, 500, { error: e.message ?? "internal server error" });
        }
    });
    // Try ports until one binds (FIX-C3 candidate guard added later — at least cap at 65535)
    const port = await new Promise((resolve, reject) => {
        let attempt = basePort;
        const tryBind = () => {
            if (attempt > 65535) {
                reject(new Error("no free port available below 65536"));
                return;
            }
            server.removeAllListeners("error");
            server.once("error", (e) => {
                if (e.code === "EADDRINUSE") {
                    attempt++;
                    tryBind();
                }
                else {
                    reject(e);
                }
            });
            server.listen(attempt, "127.0.0.1", () => resolve(attempt));
        };
        tryBind();
    });
    const close = () => new Promise((r, e) => server.close(err => err ? e(err) : r()));
    return { port, close, token: serverToken };
}
const LIFECYCLE_ACTIONS = new Set(["promote", "graduate", "reject", "archive", "reactivate", "rollback"]);
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);
/**
 * FIX-H17: only loopback Host headers are allowed. The Host comes from the
 * client's URL bar / fetch target — after a DNS rebind it would be the
 * attacker's domain (e.g. "evil.example:7777"). We reject anything that
 * isn't 127.0.0.1:<port>, [::1]:<port>, or localhost:<port>. Without a Host
 * header at all (HTTP/1.0 or malformed) we also reject for safety.
 */
function isAllowedHost(hostHeader) {
    if (!hostHeader)
        return false;
    // Strip port for comparison
    const idxColon = hostHeader.lastIndexOf(":");
    const hostOnly = (idxColon > 0 && !hostHeader.includes("]")) ? hostHeader.slice(0, idxColon)
        : hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1)
            : hostHeader;
    return hostOnly === "127.0.0.1" || hostOnly === "localhost" || hostOnly === "[::1]" || hostOnly === "::1";
}
/**
 * FIX-H17: for state-changing requests, the Origin (when sent) must match a
 * loopback origin. Same-origin requests from the served HTML always send a
 * matching Origin under modern browsers; cross-origin attackers (e.g. via
 * rebind) will set Origin to their own host.
 */
function isAllowedOrigin(originHeader) {
    if (!originHeader || originHeader === "null")
        return true; // Same-origin GETs from older clients omit Origin; only enforce when present.
    try {
        const u = new URL(originHeader);
        return u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]" || u.hostname === "::1";
    }
    catch {
        return false;
    }
}
async function route(req, res, distDir, serverToken) {
    const method = req.method ?? "GET";
    const rawUrl = req.url ?? "/";
    const url = new URL(rawUrl, "http://127.0.0.1");
    const path = url.pathname;
    // FIX-H17: Host validation runs before any further processing.
    const hostHeader = req.headers.host;
    if (!isAllowedHost(hostHeader)) {
        res.writeHead(421, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "misdirected request: only loopback Host headers accepted" }));
        return;
    }
    // FIX-H17: Origin check on state-changing methods.
    if (STATE_CHANGING_METHODS.has(method)) {
        const origin = req.headers.origin;
        if (!isAllowedOrigin(origin)) {
            sendJson(res, 403, { error: "forbidden: cross-origin request rejected" });
            return;
        }
    }
    // Security headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
    // ── Static assets ──────────────────────────────────────────────────────────
    if (method === "GET" && path === "/") {
        const indexPath = join(distDir, "index.html");
        if (!existsSync(indexPath)) {
            res.writeHead(503, { "Content-Type": "text/plain" });
            res.end("skila web UI not built yet — run npm run build");
            return;
        }
        const html = readFileSync(indexPath, "utf8");
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
        await handleGetDashboard(req, res);
        return;
    }
    // GET /api/skills
    if (method === "GET" && path === "/api/skills") {
        await handleGetSkills(req, res);
        return;
    }
    // /api/skills/:name/...
    const skillMatch = path.match(/^\/api\/skills\/([^/]+)(\/(.*))?$/);
    if (skillMatch) {
        const name = decodeURIComponent(skillMatch[1]);
        const sub = skillMatch[3] ?? "";
        // GET /api/skills/:name
        if (method === "GET" && sub === "") {
            await handleGetSkill(req, res, name);
            return;
        }
        // GET /api/skills/:name/file?path=...   (FIX-C7: now token-gated)
        if (method === "GET" && sub === "file") {
            const filePath = url.searchParams.get("path") ?? "";
            await handleGetFile(req, res, name, filePath, serverToken);
            return;
        }
        // PUT /api/skills/:name/file — write supporting (non-SKILL.md) text file
        if (method === "PUT" && sub === "file") {
            if (!validateToken(req, res, serverToken))
                return;
            await handlePutFile(req, res, name);
            return;
        }
        // GET /api/skills/:name/versions
        if (method === "GET" && sub === "versions") {
            await handleGetVersions(req, res, name);
            return;
        }
        // GET /api/skills/:name/diff?from=&to=
        if (method === "GET" && sub === "diff") {
            await handleGetDiff(req, res, name, url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? "");
            return;
        }
        // GET /api/skills/:name/feedback
        if (method === "GET" && sub === "feedback") {
            await handleGetFeedback(req, res, name);
            return;
        }
        // PUT /api/skills/:name — save SKILL.md
        if (method === "PUT" && sub === "") {
            if (!validateToken(req, res, serverToken))
                return;
            if (!checkContentTypeJson(req, res))
                return;
            await handlePutSkill(req, res, name);
            return;
        }
        // POST /api/skills/:name/feedback
        if (method === "POST" && sub === "feedback") {
            if (!validateToken(req, res, serverToken))
                return;
            if (!checkContentTypeJsonOptional(req, res))
                return;
            await handlePostFeedback(req, res, name);
            return;
        }
        // POST /api/skills/:name/translate
        if (method === "POST" && sub === "translate") {
            if (!validateToken(req, res, serverToken))
                return;
            if (!checkContentTypeJson(req, res))
                return;
            await handleTranslateSkill(req, res, name);
            return;
        }
        // POST /api/skills/:name/{lifecycle action}
        if (method === "POST" && LIFECYCLE_ACTIONS.has(sub)) {
            if (!validateToken(req, res, serverToken))
                return;
            await handleLifecycle(req, res, name, sub, url.searchParams);
            return;
        }
    }
    // GET /api/settings/translate
    if (method === "GET" && path === "/api/settings/translate") {
        if (!validateToken(req, res, serverToken))
            return;
        await handleGetTranslateSettings(req, res);
        return;
    }
    // PUT /api/settings/translate
    if (method === "PUT" && path === "/api/settings/translate") {
        if (!validateToken(req, res, serverToken))
            return;
        if (!checkContentTypeJson(req, res))
            return;
        await handlePutTranslateSettings(req, res);
        return;
    }
    sendJson(res, 404, { error: `not found: ${method} ${path}` });
}
// FIX-H13: Content-Type checks. JSON-only routes reject any other CT.
function checkContentTypeJson(req, res) {
    const ct = (req.headers["content-type"] ?? "").toString().toLowerCase();
    if (!ct.startsWith("application/json")) {
        sendJson(res, 415, { error: "unsupported media type: application/json required" });
        return false;
    }
    return true;
}
// Some endpoints (feedback) accept empty body; require JSON only when body present.
function checkContentTypeJsonOptional(req, res) {
    const cl = parseInt((req.headers["content-length"] ?? "0").toString(), 10);
    if (cl === 0)
        return true;
    return checkContentTypeJson(req, res);
}
function serveStatic(res, distDir, urlPath) {
    const rel = urlPath.replace(/^\//, "");
    const abs = join(distDir, rel);
    // FIX-H14: realpath containment — resolve symlinks before comparing
    let distRoot;
    let absResolved;
    try {
        distRoot = realpathSync(distDir);
        absResolved = realpathSync(abs);
    }
    catch {
        // File doesn't exist or can't be resolved
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
    }
    const rel2 = relative(distRoot, absResolved);
    if (rel2.startsWith("..") || rel2 === "") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
    }
    if (!existsSync(absResolved)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
    }
    const mime = absResolved.endsWith(".js") ? "application/javascript" : absResolved.endsWith(".css") ? "text/css" : "application/octet-stream";
    const data = readFileSync(absResolved);
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=3600" });
    res.end(data);
}
//# sourceMappingURL=server.js.map