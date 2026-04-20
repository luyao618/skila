// Token middleware — auth model for the local web panel.
//
// FIX-C8 — chosen model: HttpOnly cookie is the SINGLE canonical auth.
//   • Cookie is set with HttpOnly + SameSite=Strict + Path=/ on first GET /
//   • Browser auto-rides the cookie on every same-origin fetch (no JS needed)
//   • The HttpOnly flag means JS CANNOT read it → keeps the token off the page
//     in case of XSS, and avoids a future maintainer accidentally regressing
//     to a JS-readable cookie + header model.
//   • The X-Skila-Token header is still ACCEPTED on the server for programmatic
//     clients (CLI scripts, tests) that don't have cookie storage. It is NEVER
//     read by the front-end — the document.cookie call has been removed.
//   • DNS rebinding is defended at the route layer (Host/Origin checks in
//     server.ts), not here.
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export function generateToken(): string {
  return randomBytes(24).toString("hex");
}

export function getTokenFromCookie(req: IncomingMessage): string | undefined {
  const cookieHeader = req.headers.cookie ?? "";
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === "skila_token" && v) return v.trim();
  }
  return undefined;
}

export function setTokenCookie(res: ServerResponse, token: string): void {
  res.setHeader("Set-Cookie", `skila_token=${token}; Path=/; SameSite=Strict; HttpOnly`);
}

/** Returns false (and sends 403) if token missing or mismatched. */
export function validateToken(req: IncomingMessage, res: ServerResponse, serverToken: string): boolean {
  const cookie = getTokenFromCookie(req);
  // X-Skila-Token header is the OUT-OF-BAND channel for programmatic clients
  // (tests, scripts). The browser front-end relies on cookie ride-along only.
  const header = req.headers["x-skila-token"] as string | undefined;
  if (cookie === serverToken || header === serverToken) return true;
  sendJson(res, 403, { error: "forbidden: missing or invalid skila_token" });
  return false;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(payload);
}
