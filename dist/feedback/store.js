// Feedback store with mkdir-based lockfile (D6).
// 100ms acquire timeout, 3 retries jittered 30-80ms.
// Stale locks (mtime > 5s) force-unlinked.
// Atomic rename on write.
import { mkdirSync, rmdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureSkilaHome, loadConfig } from "../config/config.js";
import { atomicWriteFileSync } from "../storage/atomic.js";
export function feedbackPath() {
    return join(ensureSkilaHome(), "feedback.json");
}
function lockPath() {
    return feedbackPath() + ".lock";
}
function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
}
function jitter(min, max) {
    return min + Math.floor(Math.random() * (max - min));
}
async function acquireLock(timeoutMs, staleMs) {
    const lp = lockPath();
    const start = Date.now();
    let attempt = 0;
    while (true) {
        try {
            mkdirSync(lp, { recursive: false });
            return;
        }
        catch (err) {
            const code = err.code;
            if (code !== "EEXIST")
                throw err;
            // Check staleness
            try {
                const st = statSync(lp);
                if (Date.now() - st.mtimeMs > staleMs) {
                    try {
                        rmdirSync(lp);
                    }
                    catch { /* race */ }
                    continue;
                }
            }
            catch { /* lock vanished, retry */ }
            if (Date.now() - start >= timeoutMs && attempt >= 3) {
                throw new Error(`feedback lock acquire timeout after ${timeoutMs}ms`);
            }
            attempt++;
            await sleep(jitter(30, 80));
        }
    }
}
function releaseLock() {
    try {
        rmdirSync(lockPath());
    }
    catch { /* best-effort */ }
}
export async function withLock(fn) {
    const cfg = loadConfig();
    await acquireLock(cfg.lockTimeoutMs, cfg.lockStaleMs);
    try {
        return await fn();
    }
    finally {
        releaseLock();
    }
}
export function readFeedbackSync() {
    const p = feedbackPath();
    if (!existsSync(p))
        return {};
    try {
        const raw = readFileSync(p, "utf8");
        if (!raw.trim())
            return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
function writeFeedbackSync(data) {
    atomicWriteFileSync(feedbackPath(), JSON.stringify(data, null, 2));
}
function emptyEntry() {
    return { successRate: 0, usageCount: 0, failureCount: 0, lastUsedAt: "", invocations: [] };
}
function recompute(entry) {
    const total = entry.usageCount;
    const fails = entry.failureCount;
    entry.successRate = total === 0 ? 0 : (total - fails) / total;
}
export async function recordInvocation(name, outcome, session) {
    return withLock(() => {
        const data = readFeedbackSync();
        const entry = data[name] ?? emptyEntry();
        const inv = { ts: new Date().toISOString(), outcome, session };
        entry.invocations.push(inv);
        entry.usageCount += 1;
        if (outcome === "failure")
            entry.failureCount += 1;
        entry.lastUsedAt = inv.ts;
        recompute(entry);
        data[name] = entry;
        writeFeedbackSync(data);
        return entry;
    });
}
export async function incrementUsage(name, outcome = "success") {
    return recordInvocation(name, outcome);
}
// Synchronous variant used by hook tail-write queue (still goes through lock dir
// via a busy-loop bounded by config lockTimeoutMs).
export function recordInvocationSync(name, outcome, session) {
    const cfg = loadConfig();
    const lp = lockPath();
    const start = Date.now();
    while (true) {
        try {
            mkdirSync(lp, { recursive: false });
            break;
        }
        catch (err) {
            const code = err.code;
            if (code !== "EEXIST")
                throw err;
            try {
                const st = statSync(lp);
                if (Date.now() - st.mtimeMs > cfg.lockStaleMs) {
                    try {
                        rmdirSync(lp);
                    }
                    catch { }
                    continue;
                }
            }
            catch { }
            if (Date.now() - start > cfg.lockTimeoutMs * 4) {
                throw new Error("feedback lock timeout (sync)");
            }
            // small busy spin
            const spinUntil = Date.now() + jitter(5, 15);
            while (Date.now() < spinUntil) { /* spin */ }
        }
    }
    try {
        const data = readFeedbackSync();
        const entry = data[name] ?? emptyEntry();
        const inv = { ts: new Date().toISOString(), outcome, session };
        entry.invocations.push(inv);
        entry.usageCount += 1;
        if (outcome === "failure")
            entry.failureCount += 1;
        entry.lastUsedAt = inv.ts;
        recompute(entry);
        data[name] = entry;
        writeFeedbackSync(data);
        return entry;
    }
    finally {
        try {
            rmdirSync(lp);
        }
        catch { }
    }
}
//# sourceMappingURL=store.js.map