// Feedback store with mkdir-based lockfile (D6).
// 100ms acquire timeout, 3 retries jittered 30-80ms.
// Stale locks (mtime > 5s) force-unlinked.
// Atomic rename on write.
import { mkdirSync, rmdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureSkilaHome, loadConfig } from "../config/config.js";
import { atomicWriteFileSync } from "../storage/atomic.js";
const MAX_LOCK_ATTEMPTS = 3;
const MAX_INVOCATIONS = 200;
/**
 * Cap entry.invocations at MAX_INVOCATIONS.
 * Overflowed (oldest) entries are collapsed into invocationsHistogram.hourly
 * — a 24-slot array where index = hour-of-day (UTC).
 */
function capInvocations(entry) {
    if (entry.invocations.length <= MAX_INVOCATIONS)
        return;
    const overflow = entry.invocations.splice(0, entry.invocations.length - MAX_INVOCATIONS);
    const histogram = entry.invocationsHistogram ?? { hourly: new Array(24).fill(0) };
    for (const inv of overflow) {
        const hour = new Date(inv.ts).getUTCHours();
        histogram.hourly[hour] = (histogram.hourly[hour] ?? 0) + 1;
    }
    entry.invocationsHistogram = histogram;
}
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
            if (Date.now() - start >= timeoutMs || attempt >= MAX_LOCK_ATTEMPTS) {
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
        if (!parsed || typeof parsed !== "object")
            return {};
        // v1 envelope: { schemaVersion: 1, entries: { ... } }
        if (parsed.schemaVersion === 1 && parsed.entries && typeof parsed.entries === "object") {
            return parsed.entries;
        }
        // v0: raw FeedbackStoreShape object (transparent upgrade on next write)
        return parsed;
    }
    catch {
        return {};
    }
}
function writeFeedbackSync(data) {
    const envelope = { schemaVersion: 1, entries: data };
    atomicWriteFileSync(feedbackPath(), JSON.stringify(envelope, null, 2));
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
        capInvocations(entry);
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
// Synchronous variant used by hook tail-write queue.
// FIX-M19: busy-spin replaced with Atomics.wait to yield CPU during lock contention.
export function recordInvocationSync(name, outcome, session) {
    const cfg = loadConfig();
    const lp = lockPath();
    const start = Date.now();
    // Shared buffer for Atomics.wait sleep (1 element Int32Array)
    const sleepBuf = new SharedArrayBuffer(4);
    const sleepView = new Int32Array(sleepBuf);
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
            // Yield CPU with Atomics.wait instead of busy-spin
            Atomics.wait(sleepView, 0, 0, jitter(5, 15));
        }
    }
    try {
        const data = readFeedbackSync();
        const entry = data[name] ?? emptyEntry();
        const inv = { ts: new Date().toISOString(), outcome, session };
        entry.invocations.push(inv);
        capInvocations(entry);
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