// Storage adapter factory (AC21).
// - Lazy singleton.
// - Reads/writes ~/.claude/skila-data/.adapter-mode sentinel.
// - Refuses silent switch (Pre-mortem Scenario C): if sentinel says "git" but
//   .git/ is missing (or vice versa), throws with hint pointing at
//   `skila doctor --fix-storage`.
// - Logs adapter selection ONCE per process.
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ensureSkilaHome, skilaHome } from "../config/config.js";
import { StorageAdapterError } from "./types.js";
import { GitBackedStorage, isGitAvailable } from "./git.js";
import { FlatFileStorage } from "./flat.js";
let cached = null;
let logged = false;
export function sentinelPath(home) {
    return join(home ?? skilaHome(), ".adapter-mode");
}
function readSentinel(home) {
    const p = sentinelPath(home);
    if (!existsSync(p))
        return undefined;
    const txt = readFileSync(p, "utf8").trim();
    if (txt === "git" || txt === "flat")
        return txt;
    return undefined;
}
function writeSentinel(home, mode) {
    mkdirSync(home, { recursive: true });
    writeFileSync(sentinelPath(home), mode + "\n");
}
function logSelection(mode) {
    if (logged)
        return;
    logged = true;
    process.stderr.write(`skila: storage adapter = ${mode}\n`);
}
export function resetAdapterCacheForTests() {
    cached = null;
    logged = false;
}
export async function getAdapter() {
    if (cached)
        return cached;
    const home = ensureSkilaHome();
    const sentinel = readSentinel(home);
    const gitDirExists = existsSync(join(home, ".git"));
    if (sentinel) {
        if (sentinel === "git" && !gitDirExists) {
            throw new StorageAdapterError("E_ADAPTER_MISMATCH", `storage adapter sentinel says 'git' but ${home}/.git/ is missing — refusing silent switch to flat`, "run `skila doctor --fix-storage` to reconcile");
        }
        if (sentinel === "flat" && gitDirExists) {
            throw new StorageAdapterError("E_ADAPTER_MISMATCH", `storage adapter sentinel says 'flat' but ${home}/.git/ exists — refusing silent switch to git`, "run `skila doctor --fix-storage` to reconcile");
        }
        if (sentinel === "git") {
            const a = new GitBackedStorage(home);
            await a.init();
            cached = a;
        }
        else {
            const a = new FlatFileStorage();
            await a.init();
            cached = a;
        }
        logSelection(cached.mode);
        await recoverMoveIntent(cached, home);
        return cached;
    }
    // FIX-C6: If sentinel is absent but .git/ or versions/ exist in home,
    // this is not a genuine first-run — refuse silently switching adapters.
    if (existsSync(join(home, ".git")) || existsSync(join(home, "versions"))) {
        throw new StorageAdapterError("E_ADAPTER_MISSING_SENTINEL", `storage adapter sentinel missing but ${home} looks initialized (.git/ or versions/ present) — refusing first-run probe`, "run `skila doctor --fix-storage` to reconcile");
    }
    // SKILA_FORCE_ADAPTER=flat bypasses git probe (test isolation + no-git environments).
    if (process.env.SKILA_FORCE_ADAPTER === "flat") {
        const a = new FlatFileStorage();
        await a.init();
        cached = a;
        writeSentinel(home, "flat");
        logSelection(cached.mode);
        await recoverMoveIntent(cached, home);
        return cached;
    }
    // No sentinel — first run. Probe.
    const gitOk = await isGitAvailable();
    let writable = true;
    try {
        const probe = join(home, ".write-probe");
        writeFileSync(probe, "ok");
        try {
            writeFileSync(probe, "");
        }
        catch { }
        try {
            (await import("node:fs")).unlinkSync(probe);
        }
        catch { }
    }
    catch {
        writable = false;
    }
    if (gitOk && writable) {
        const a = new GitBackedStorage(home);
        await a.init();
        cached = a;
        writeSentinel(home, "git");
    }
    else {
        const a = new FlatFileStorage();
        await a.init();
        cached = a;
        writeSentinel(home, "flat");
    }
    logSelection(cached.mode);
    await recoverMoveIntent(cached, home);
    return cached;
}
export function moveIntentPath(home) {
    return join(home ?? skilaHome(), ".move-intent.json");
}
function writeMoveIntent(intent) {
    const home = skilaHome();
    writeFileSync(moveIntentPath(home), JSON.stringify(intent, null, 2));
}
function clearMoveIntent() {
    const p = moveIntentPath();
    try {
        if (existsSync(p))
            unlinkSync(p);
    }
    catch { }
}
export function readMoveIntent(home) {
    const p = moveIntentPath(home);
    if (!existsSync(p))
        return undefined;
    try {
        return JSON.parse(readFileSync(p, "utf8"));
    }
    catch {
        return undefined;
    }
}
/**
 * Wraps adapter.moveSkill with write-ahead intent logging (FIX-H7).
 * Call this instead of adapter.moveSkill directly.
 */
export async function moveSkillWithIntentLog(adapter, name, fromStatus, toStatus) {
    // Write intent before any mutation.
    writeMoveIntent({ name, fromStatus, toStatus, ts: new Date().toISOString() });
    try {
        await adapter.moveSkill(name, fromStatus, toStatus);
    }
    catch (err) {
        // Move failed — leave intent file so recovery can retry on next init.
        throw err;
    }
    // Success — clear the intent.
    clearMoveIntent();
}
/**
 * On adapter startup, replay any partial move intent.
 * If the move already completed (fromStatus dir gone / toStatus dir present), just clear.
 * Otherwise retry the move.
 */
export async function recoverMoveIntent(adapter, home) {
    const intent = readMoveIntent(home);
    if (!intent)
        return;
    try {
        await adapter.moveSkill(intent.name, intent.fromStatus, intent.toStatus);
    }
    catch {
        // Ignore errors during recovery (e.g. E_NOT_FOUND if already completed).
    }
    clearMoveIntent();
}
//# sourceMappingURL=index.js.map