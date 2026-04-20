// skila_token cookie: set on first GET /, validates on write endpoints (CSRF guard).
import { randomBytes } from "node:crypto";
export function generateToken() {
    return randomBytes(24).toString("hex");
}
export function getTokenFromCookie(req) {
    const cookieHeader = req.headers.cookie ?? "";
    for (const part of cookieHeader.split(";")) {
        const [k, v] = part.trim().split("=");
        if (k === "skila_token" && v)
            return v.trim();
    }
    return undefined;
}
export function setTokenCookie(res, token) {
    res.setHeader("Set-Cookie", `skila_token=${token}; Path=/; SameSite=Strict; HttpOnly`);
}
/** Returns false (and sends 403) if token missing or mismatched. */
export function validateToken(req, res, serverToken) {
    const cookie = getTokenFromCookie(req);
    // Also accept token in X-Skila-Token header for programmatic clients (tests).
    const header = req.headers["x-skila-token"];
    if (cookie === serverToken || header === serverToken)
        return true;
    sendJson(res, 403, { error: "forbidden: missing or invalid skila_token" });
    return false;
}
export function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(payload);
}
//# sourceMappingURL=token.js.map