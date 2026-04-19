// skila_token cookie: set on first GET /, validates on write endpoints (CSRF guard).
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
  // Also accept token in X-Skila-Token header for programmatic clients (tests).
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
