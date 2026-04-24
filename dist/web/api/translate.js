// POST /api/skills/:name/translate — translate SKILL.md via LLM (streaming SSE)
// GET  /api/settings/translate — read translate settings
// PUT  /api/settings/translate — save translate settings
import { readFileSync } from "node:fs";
import { findSkill } from "../../inventory/scanner.js";
import { loadConfig, saveConfig } from "../../config/config.js";
import { sendJson } from "../middleware/token.js";
import { MAX_BODY_BYTES } from "../server.js";
const SUPPORTED_LANGS = {
    zh: "Chinese (Simplified)",
    "zh-TW": "Chinese (Traditional)",
    ja: "Japanese",
    ko: "Korean",
    fr: "French",
    de: "German",
    es: "Spanish",
    pt: "Portuguese",
    ru: "Russian",
    ar: "Arabic",
    it: "Italian",
};
async function readBoundedBody(req) {
    let body = "";
    let received = 0;
    for await (const chunk of req) {
        received += chunk.length;
        if (received > MAX_BODY_BYTES)
            return { tooLarge: true };
        body += chunk;
    }
    return body;
}
function sseWrite(res, data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}
export async function handleTranslateSkill(req, res, skillName) {
    const bodyOrLimit = await readBoundedBody(req);
    if (typeof bodyOrLimit !== "string") {
        sendJson(res, 413, { error: "request body too large" });
        return;
    }
    let payload;
    try {
        payload = JSON.parse(bodyOrLimit);
    }
    catch {
        sendJson(res, 400, { error: "invalid JSON body" });
        return;
    }
    const skill = findSkill(skillName);
    if (!skill) {
        sendJson(res, 404, { error: `skill not found: ${skillName}` });
        return;
    }
    const config = loadConfig();
    const targetLang = payload.targetLang || config.translateTargetLang || "zh";
    const langLabel = SUPPORTED_LANGS[targetLang] || targetLang;
    const content = readFileSync(skill.path, "utf8");
    // Resolve API config: config overrides > env vars
    const baseUrl = config.translateBaseUrl || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
    const apiKey = process.env.ANTHROPIC_API_KEY || "";
    const model = config.translateModel || "claude-sonnet-4-20250514";
    if (!apiKey) {
        sendJson(res, 500, { error: "no API key configured: set ANTHROPIC_API_KEY environment variable or configure in Settings" });
        return;
    }
    const systemPrompt = `You are a professional translator. Translate the following Markdown document to ${langLabel} (${targetLang}). Rules:
- Preserve ALL Markdown formatting exactly (headings, lists, code blocks, bold, italic, links)
- Preserve YAML frontmatter block (between --- delimiters) as-is, EXCEPT translate the "description" field value
- Preserve code blocks and inline code as-is, do NOT translate code
- Only translate natural language text
- Output ONLY the translated document, no explanations`;
    // Start streaming response
    let upstreamResponse;
    try {
        upstreamResponse = await fetch(`${baseUrl}/v1/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model,
                max_tokens: 8192,
                stream: true,
                system: systemPrompt,
                messages: [{ role: "user", content }],
            }),
        });
    }
    catch (err) {
        sendJson(res, 502, { error: `translation failed: ${err.message ?? "network error"}` });
        return;
    }
    if (!upstreamResponse.ok) {
        const errBody = await upstreamResponse.text().catch(() => "");
        if (upstreamResponse.status === 401) {
            sendJson(res, 502, { error: "LLM API authentication failed: check your API key" });
        }
        else if (upstreamResponse.status === 429) {
            sendJson(res, 502, { error: "LLM API rate limited: please try again later" });
        }
        else {
            sendJson(res, 502, { error: `LLM API error (${upstreamResponse.status}): ${errBody.slice(0, 200)}` });
        }
        return;
    }
    // SSE response to client
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    });
    try {
        const body = upstreamResponse.body;
        if (!body) {
            sseWrite(res, { type: "error", error: "empty upstream body" });
            res.end();
            return;
        }
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buf += decoder.decode(value, { stream: true });
            // Parse SSE lines from Anthropic stream
            const lines = buf.split("\n");
            buf = lines.pop() ?? ""; // keep incomplete line
            for (const line of lines) {
                if (!line.startsWith("data: "))
                    continue;
                const raw = line.slice(6);
                if (raw === "[DONE]")
                    continue;
                try {
                    const evt = JSON.parse(raw);
                    if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                        sseWrite(res, { type: "delta", text: evt.delta.text });
                    }
                }
                catch { /* skip non-JSON lines */ }
            }
        }
        sseWrite(res, { type: "done", lang: targetLang });
    }
    catch (err) {
        sseWrite(res, { type: "error", error: err.message ?? "stream error" });
    }
    finally {
        res.end();
    }
}
export async function handleGetTranslateSettings(_req, res) {
    const config = loadConfig();
    sendJson(res, 200, {
        targetLang: config.translateTargetLang || "zh",
        customBaseUrl: config.translateBaseUrl || "",
        model: config.translateModel || "claude-sonnet-4-20250514",
        supportedLangs: SUPPORTED_LANGS,
        hasEnvApiKey: !!process.env.ANTHROPIC_API_KEY,
        hasEnvBaseUrl: !!process.env.ANTHROPIC_BASE_URL,
    });
}
export async function handlePutTranslateSettings(req, res) {
    const bodyOrLimit = await readBoundedBody(req);
    if (typeof bodyOrLimit !== "string") {
        sendJson(res, 413, { error: "request body too large" });
        return;
    }
    let payload;
    try {
        payload = JSON.parse(bodyOrLimit);
    }
    catch {
        sendJson(res, 400, { error: "invalid JSON body" });
        return;
    }
    const updates = {};
    if (typeof payload.targetLang === "string")
        updates.translateTargetLang = payload.targetLang;
    if (typeof payload.customBaseUrl === "string")
        updates.translateBaseUrl = payload.customBaseUrl || undefined;
    if (typeof payload.model === "string")
        updates.translateModel = payload.model || undefined;
    saveConfig(updates);
    sendJson(res, 200, { ok: true });
}
//# sourceMappingURL=translate.js.map