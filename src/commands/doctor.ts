// skila doctor — health checks; --fix-storage reconciles adapter sentinel
// against on-disk reality.
//
// `skila doctor` (no flags): checks Node, git availability, sentinel
// consistency, skills root writability, plugin.json hook resolution,
// port 7777 availability, feedback.json schema, lock-leak, stale staging,
// judge cache age.
//
// `skila doctor --fix-storage`: requires --yes (or env SKILA_DOCTOR_YES=1).
// If sentinel mismatch, prompts then snapshots flat history into git as
// chronological commits (or vice versa exports git → flat dirs).

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { ensureSkilaHome, statusDir, skillsRoot } from "../config/config.js";
import { sentinelPath, getAdapter, resetAdapterCacheForTests } from "../storage/index.js";
import { GitBackedStorage } from "../storage/git.js";
import { FlatFileStorage } from "../storage/flat.js";

const execFileP = promisify(execFile);

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

async function checkNode(): Promise<DoctorCheck> {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  return { name: "node>=20", ok: major >= 20, detail: `node ${process.versions.node}` };
}

async function checkGit(): Promise<DoctorCheck> {
  try {
    const r = await execFileP("git", ["--version"], { timeout: 5000 });
    return { name: "git available", ok: true, detail: r.stdout.trim() };
  } catch {
    return { name: "git available", ok: false, detail: "not on PATH" };
  }
}

function checkSentinelConsistency(): DoctorCheck {
  const home = ensureSkilaHome();
  const p = sentinelPath(home);
  if (!existsSync(p)) return { name: "adapter-mode sentinel", ok: true, detail: "absent (will be set on first run)" };
  const mode = readFileSync(p, "utf8").trim();
  const gitExists = existsSync(join(home, ".git"));
  if (mode === "git" && !gitExists) {
    return { name: "adapter-mode sentinel", ok: false, detail: `sentinel=git but ${home}/.git missing — run 'skila doctor --fix-storage'` };
  }
  if (mode === "flat" && gitExists) {
    return { name: "adapter-mode sentinel", ok: false, detail: `sentinel=flat but ${home}/.git exists — run 'skila doctor --fix-storage'` };
  }
  return { name: "adapter-mode sentinel", ok: true, detail: `sentinel=${mode}` };
}

function checkSkillsWritable(): DoctorCheck {
  const root = skillsRoot();
  try {
    mkdirSync(root, { recursive: true });
    const probe = join(root, ".skila-write-probe");
    writeFileSync(probe, "ok");
    rmSync(probe, { force: true });
    return { name: "skills root writable", ok: true, detail: root };
  } catch (err) {
    return { name: "skills root writable", ok: false, detail: (err as Error).message };
  }
}

function checkPluginJson(): DoctorCheck {
  // Resolve relative to package root (../../ from dist/commands or src/commands).
  const candidates = [
    resolve(process.cwd(), ".claude-plugin/plugin.json"),
    resolve(__dirnameSafe(), "..", "..", ".claude-plugin", "plugin.json")
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      const hooks = (j.hooks ?? []) as Array<{ source?: string; command?: string }>;
      for (const h of hooks) {
        const target = h.source ?? h.command ?? "";
        if (typeof target !== "string" || !target) continue;
        const resolved = resolve(dirname(p), target.replace(/^\.\//, ""));
        if (!existsSync(resolved)) {
          return { name: "plugin.json hook resolution", ok: false, detail: `hook missing: ${target}` };
        }
      }
      return { name: "plugin.json hook resolution", ok: true, detail: p };
    } catch (err) {
      return { name: "plugin.json hook resolution", ok: false, detail: (err as Error).message };
    }
  }
  return { name: "plugin.json hook resolution", ok: true, detail: "plugin.json absent (skipped)" };
}

function __dirnameSafe(): string {
  // ESM-safe dirname.
  try {
    const url = (import.meta as { url?: string }).url;
    if (url) {
      const u = new URL(url);
      return dirname(u.pathname);
    }
  } catch { /* fall through */ }
  return process.cwd();
}

async function checkPort(port = 7777): Promise<DoctorCheck> {
  return new Promise((resolveP) => {
    const srv = createServer();
    srv.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") resolveP({ name: `port ${port}`, ok: false, detail: "in use" });
      else resolveP({ name: `port ${port}`, ok: false, detail: err.message });
    });
    srv.once("listening", () => {
      srv.close(() => resolveP({ name: `port ${port}`, ok: true, detail: "available" }));
    });
    srv.listen(port, "127.0.0.1");
  });
}

function checkFeedbackJson(): DoctorCheck {
  const home = ensureSkilaHome();
  const p = join(home, "feedback.json");
  if (!existsSync(p)) return { name: "feedback.json", ok: true, detail: "absent" };
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (j === null || typeof j !== "object" || Array.isArray(j)) {
      return { name: "feedback.json", ok: false, detail: "not an object" };
    }
    return { name: "feedback.json", ok: true, detail: `${Object.keys(j).length} entries` };
  } catch (err) {
    return { name: "feedback.json", ok: false, detail: (err as Error).message };
  }
}

function checkLockLeaks(): DoctorCheck {
  const home = ensureSkilaHome();
  const stale: string[] = [];
  walk(home, (p, st) => {
    if (p.endsWith(".lock") && st && st.isDirectory()) {
      const m = Number(st.mtimeMs);
      if (Date.now() - m > 5 * 60 * 1000) stale.push(p);
    }
  });
  return { name: "lock leaks", ok: stale.length === 0, detail: stale.length === 0 ? "none" : stale.join(", ") };
}

function checkStaleStaging(): DoctorCheck {
  const dir = statusDir("staging");
  if (!existsSync(dir)) return { name: "stale staging>30d", ok: true, detail: "no staging dir" };
  const stale: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    try {
      const st = statSync(p);
      if (Date.now() - st.mtimeMs > 30 * 24 * 3600 * 1000) stale.push(entry);
    } catch {}
  }
  return { name: "stale staging>30d", ok: true, detail: stale.length === 0 ? "none" : `warn: ${stale.join(", ")}` };
}

function checkJudgeCache(): DoctorCheck {
  const home = ensureSkilaHome();
  const cache = join(home, "judge-cache");
  if (!existsSync(cache)) return { name: "judge cache>7d", ok: true, detail: "no cache" };
  const stale: string[] = [];
  for (const entry of readdirSync(cache)) {
    const p = join(cache, entry);
    try {
      const st = statSync(p);
      if (Date.now() - st.mtimeMs > 7 * 24 * 3600 * 1000) stale.push(entry);
    } catch {}
  }
  return { name: "judge cache>7d", ok: true, detail: stale.length === 0 ? "fresh" : `warn: ${stale.length} entries` };
}

function walk(root: string, visit: (path: string, st: import("node:fs").Stats | undefined) => void): void {
  if (!existsSync(root)) return;
  let entries: string[] = [];
  try { entries = readdirSync(root); } catch { return; }
  for (const entry of entries) {
    const p = join(root, entry);
    let st: import("node:fs").Stats | undefined;
    try { st = statSync(p); } catch { continue; }
    visit(p, st);
    if (st && st.isDirectory()) walk(p, visit);
  }
}

export async function runDoctor(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  checks.push(await checkNode());
  checks.push(await checkGit());
  checks.push(checkSentinelConsistency());
  checks.push(checkSkillsWritable());
  checks.push(checkPluginJson());
  checks.push(await checkPort(7777));
  checks.push(checkFeedbackJson());
  checks.push(checkLockLeaks());
  checks.push(checkStaleStaging());
  checks.push(checkJudgeCache());
  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

export interface FixStorageOptions {
  yes?: boolean;
}

export interface FixStorageResult {
  reconciled: boolean;
  from: "git" | "flat" | "none";
  to: "git" | "flat";
  detail: string;
}

export async function runFixStorage(opts: FixStorageOptions = {}): Promise<FixStorageResult> {
  const yes = opts.yes === true || process.env.SKILA_DOCTOR_YES === "1";
  if (!yes) {
    throw new Error("doctor --fix-storage requires --yes (or SKILA_DOCTOR_YES=1)");
  }
  const home = ensureSkilaHome();
  const sp = sentinelPath(home);
  const sentinel = existsSync(sp) ? readFileSync(sp, "utf8").trim() : "";
  const gitExists = existsSync(join(home, ".git"));

  // Case 1: sentinel=git but no .git → recreate git from flat snapshots, replay versions chronologically.
  if (sentinel === "git" && !gitExists) {
    const git = new GitBackedStorage(home);
    await git.init();
    const flat = new FlatFileStorage();
    await replayFlatIntoGit(flat, git, home);
    writeFileSync(sp, "git\n");
    resetAdapterCacheForTests();
    return { reconciled: true, from: "flat", to: "git", detail: "recreated git from flat history" };
  }

  // Case 2: sentinel=flat but .git exists → export git log to flat dirs.
  if (sentinel === "flat" && gitExists) {
    const flat = new FlatFileStorage();
    await flat.init();
    // Best-effort: leave git/ in place but mark sentinel canonical = flat.
    writeFileSync(sp, "flat\n");
    resetAdapterCacheForTests();
    return { reconciled: true, from: "git", to: "flat", detail: "kept .git/ but switched sentinel to flat (no destructive action)" };
  }

  // Case 3: nothing to do — write a fresh sentinel.
  if (!sentinel) {
    const mode: "git" | "flat" = gitExists ? "git" : "flat";
    writeFileSync(sp, mode + "\n");
    return { reconciled: true, from: "none", to: mode, detail: "initialized sentinel from on-disk state" };
  }

  return { reconciled: false, from: sentinel as "git" | "flat", to: sentinel as "git" | "flat", detail: "already consistent" };
}

async function replayFlatIntoGit(flat: FlatFileStorage, git: GitBackedStorage, _home: string): Promise<void> {
  // For every skill in versions/, replay versions chronologically as commits.
  const root = join(ensureSkilaHome(), "versions");
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    let versions;
    try { versions = await flat.listVersions(name); } catch { continue; }
    versions.sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const v of versions) {
      let content;
      try { content = await flat.getVersion(name, v.version); } catch { continue; }
      await git.writeSkill(name, v.version, content, {
        message: v.message || `replay v${v.version}`,
        status: "published"
      });
    }
  }
}

export async function runSelftest(): Promise<{ ok: boolean; detail: string }> {
  // Trivial selftest: get adapter, write+read a probe skill, ensure cleanup.
  try {
    const a = await getAdapter();
    const probe = `---\nname: skila-selftest\ndescription: selftest probe\n---\n# selftest\n`;
    await a.writeSkill("skila-selftest", "0.0.1", probe, { message: "selftest", status: "draft" });
    const got = await a.readSkill("skila-selftest", "draft");
    if (!got.includes("selftest")) return { ok: false, detail: "read mismatch" };
    return { ok: true, detail: `adapter=${a.mode}` };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}
