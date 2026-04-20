// Storage adapter factory (AC21).
// - Lazy singleton.
// - Reads/writes ~/.claude/skila-data/.adapter-mode sentinel.
// - Refuses silent switch (Pre-mortem Scenario C): if sentinel says "git" but
//   .git/ is missing (or vice versa), throws with hint pointing at
//   `skila doctor --fix-storage`.
// - Logs adapter selection ONCE per process.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ensureSkilaHome, skilaHome } from "../config/config.js";
import type { StorageAdapter } from "./types.js";
import { StorageAdapterError } from "./types.js";
import { GitBackedStorage, isGitAvailable } from "./git.js";
import { FlatFileStorage } from "./flat.js";

let cached: StorageAdapter | null = null;
let logged = false;

export function sentinelPath(home?: string): string {
  return join(home ?? skilaHome(), ".adapter-mode");
}

function readSentinel(home: string): "git" | "flat" | undefined {
  const p = sentinelPath(home);
  if (!existsSync(p)) return undefined;
  const txt = readFileSync(p, "utf8").trim();
  if (txt === "git" || txt === "flat") return txt;
  return undefined;
}

function writeSentinel(home: string, mode: "git" | "flat"): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(sentinelPath(home), mode + "\n");
}

function logSelection(mode: "git" | "flat"): void {
  if (logged) return;
  logged = true;
  process.stderr.write(`skila: storage adapter = ${mode}\n`);
}

export function resetAdapterCacheForTests(): void {
  cached = null;
  logged = false;
}

export async function getAdapter(): Promise<StorageAdapter> {
  if (cached) return cached;
  const home = ensureSkilaHome();
  const sentinel = readSentinel(home);
  const gitDirExists = existsSync(join(home, ".git"));

  if (sentinel) {
    if (sentinel === "git" && !gitDirExists) {
      throw new StorageAdapterError(
        "E_ADAPTER_MISMATCH",
        `storage adapter sentinel says 'git' but ${home}/.git/ is missing — refusing silent switch to flat`,
        "run `skila doctor --fix-storage` to reconcile"
      );
    }
    if (sentinel === "flat" && gitDirExists) {
      throw new StorageAdapterError(
        "E_ADAPTER_MISMATCH",
        `storage adapter sentinel says 'flat' but ${home}/.git/ exists — refusing silent switch to git`,
        "run `skila doctor --fix-storage` to reconcile"
      );
    }
    if (sentinel === "git") {
      const a = new GitBackedStorage(home);
      await a.init();
      cached = a;
    } else {
      const a = new FlatFileStorage();
      await a.init();
      cached = a;
    }
    logSelection(cached.mode);
    return cached;
  }

  // FIX-C6: If sentinel is absent but .git/ or versions/ exist in home,
  // this is not a genuine first-run — refuse silently switching adapters.
  if (existsSync(join(home, ".git")) || existsSync(join(home, "versions"))) {
    throw new StorageAdapterError(
      "E_ADAPTER_MISSING_SENTINEL",
      `storage adapter sentinel missing but ${home} looks initialized (.git/ or versions/ present) — refusing first-run probe`,
      "run `skila doctor --fix-storage` to reconcile"
    );
  }

  // SKILA_FORCE_ADAPTER=flat bypasses git probe (test isolation + no-git environments).
  if (process.env.SKILA_FORCE_ADAPTER === "flat") {
    const a = new FlatFileStorage();
    await a.init();
    cached = a;
    writeSentinel(home, "flat");
    logSelection(cached.mode);
    return cached;
  }

  // No sentinel — first run. Probe.
  const gitOk = await isGitAvailable();
  let writable = true;
  try {
    const probe = join(home, ".write-probe");
    writeFileSync(probe, "ok");
    try { writeFileSync(probe, ""); } catch {}
    try { (await import("node:fs")).unlinkSync(probe); } catch {}
  } catch {
    writable = false;
  }

  if (gitOk && writable) {
    const a = new GitBackedStorage(home);
    await a.init();
    cached = a;
    writeSentinel(home, "git");
  } else {
    const a = new FlatFileStorage();
    await a.init();
    cached = a;
    writeSentinel(home, "flat");
  }
  logSelection(cached.mode);
  return cached;
}
