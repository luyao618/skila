// GitBackedStorage (AC19). Uses child_process.execFile('git', …).
// NO simple-git, NO nodegit. All writes go through atomic.ts (AC22).
//
// Repository layout (rooted at SKILA_HOME):
//   <skila-data>/
//     .git/
//     skills/
//       published/<name>/SKILL.md
//       draft/<name>/SKILL.md
//       staging/<name>/SKILL.md
//       archived/<name>/SKILL.md
//       disabled/<name>/SKILL.md
//
// Live SKILL files in ~/.claude/skills/{,.draft-skila,.staging-skila,…} continue
// to be written via atomic.ts so the CC loader sees them; the git repo holds
// the version history, while the live tree is synced to match.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, renameSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import type { SkillStatus } from "../types.js";
import type { StorageAdapter, VersionRecord, WriteSkillMetadata } from "./types.js";
import { StorageAdapterError } from "./types.js";
import { ensureSkilaHome, statusDir } from "../config/config.js";
import { atomicWriteFileSync } from "./atomic.js";

const execFileP = promisify(execFile);
const GIT_TIMEOUT_MS = 5000;

async function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const r = await execFileP("git", args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  } catch (err: any) {
    if (err && err.killed && err.signal === "SIGTERM") {
      throw new StorageAdapterError("E_GIT_TIMEOUT", `git ${args.join(" ")} timed out after ${GIT_TIMEOUT_MS}ms`);
    }
    if (err && err.code === "ENOENT") {
      throw new StorageAdapterError("E_GIT_MISSING", "git executable not found on PATH");
    }
    const msg = (err?.stderr || err?.message || String(err)).toString();
    throw new StorageAdapterError("E_GIT", `git ${args.join(" ")} failed: ${msg.trim()}`);
  }
}

function repoRelPath(name: string, status: SkillStatus): string {
  return join("skills", status, name, "SKILL.md");
}

function liveSkillPath(name: string, status: SkillStatus): string {
  return join(statusDir(status), name, "SKILL.md");
}

function findLiveStatus(name: string): SkillStatus | undefined {
  const order: SkillStatus[] = ["draft", "staging", "published", "archived", "disabled"];
  for (const s of order) {
    if (existsSync(liveSkillPath(name, s))) return s;
  }
  return undefined;
}

export class GitBackedStorage implements StorageAdapter {
  readonly mode = "git" as const;
  private home: string;

  constructor(home?: string) {
    this.home = home ?? ensureSkilaHome();
  }

  async init(): Promise<void> {
    const home = this.home;
    mkdirSync(home, { recursive: true });
    if (!existsSync(join(home, ".git"))) {
      await git(["init", "-q"], home);
      await git(["config", "user.email", "skila@local"], home);
      await git(["config", "user.name", "skila"], home);
      // initial commit so HEAD exists
      const seed = join(home, ".skila-init");
      atomicWriteFileSync(seed, `skila storage init ${new Date().toISOString()}\n`);
      await git(["add", ".skila-init"], home);
      await git(["commit", "-q", "-m", "skila: storage init"], home);
    }
  }

  async writeSkill(name: string, version: string, content: string, metadata: WriteSkillMetadata): Promise<void> {
    await this.init();
    const rel = repoRelPath(name, metadata.status);
    const target = join(this.home, rel);
    mkdirSync(dirname(target), { recursive: true });
    atomicWriteFileSync(target, content);
    await git(["add", "--", rel], this.home);
    // Allow empty-on-no-change commits so version history records the bump.
    await git(["commit", "-q", "--allow-empty", "-m", `${metadata.message} [v${version}]`], this.home);

    // Mirror to live skill tree (atomic).
    const live = liveSkillPath(name, metadata.status);
    mkdirSync(dirname(live), { recursive: true });
    atomicWriteFileSync(live, content);
  }

  async moveSkill(name: string, fromStatus: SkillStatus, toStatus: SkillStatus): Promise<void> {
    await this.init();
    const fromRel = repoRelPath(name, fromStatus);
    const toRel = repoRelPath(name, toStatus);
    const fromAbs = join(this.home, fromRel);
    const toAbs = join(this.home, toRel);
    if (existsSync(fromAbs)) {
      mkdirSync(dirname(toAbs), { recursive: true });
      try { await git(["mv", fromRel, toRel], this.home); }
      catch {
        // non-tracked file — fall back to fs rename + add
        try { renameSync(fromAbs, toAbs); } catch { copyFileSync(fromAbs, toAbs); }
        await git(["add", "--", toRel], this.home);
      }
      await git(["commit", "-q", "--allow-empty", "-m", `move ${name}: ${fromStatus}->${toStatus}`], this.home);
    }

    // Mirror live tree (delegate to a generic dir move via fs).
    const liveSrc = join(statusDir(fromStatus), name);
    const liveDst = join(statusDir(toStatus), name);
    if (existsSync(liveSrc) && liveSrc !== liveDst) {
      mkdirSync(dirname(liveDst), { recursive: true });
      if (existsSync(liveDst)) rmSync(liveDst, { recursive: true, force: true });
      try { renameSync(liveSrc, liveDst); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EXDEV") {
          copyDirRecursive(liveSrc, liveDst);
          rmSync(liveSrc, { recursive: true, force: true });
        } else throw err;
      }
    }
  }

  async readSkill(name: string, status: SkillStatus): Promise<string> {
    const live = liveSkillPath(name, status);
    if (existsSync(live)) return readFileSync(live, "utf8");
    const repo = join(this.home, repoRelPath(name, status));
    if (existsSync(repo)) return readFileSync(repo, "utf8");
    throw new StorageAdapterError("E_NOT_FOUND", `git: skill ${name} not found in status=${status}`);
  }

  async getVersion(name: string, version: string): Promise<string> {
    await this.init();
    // Find a commit whose subject contains "[v<version>]" and read the file from that ref.
    const log = await git(["log", "--all", "--pretty=format:%H|%s"], this.home);
    const lines = log.stdout.split("\n").filter(Boolean);
    const tag = `[v${version}]`;
    for (const line of lines) {
      const idx = line.indexOf("|");
      const sha = line.slice(0, idx);
      const subject = line.slice(idx + 1);
      if (!subject.includes(tag)) continue;
      // Find which status path holds this version at that sha.
      for (const s of ["published", "staging", "draft", "archived", "disabled"] as SkillStatus[]) {
        const rel = repoRelPath(name, s);
        try {
          const r = await git(["show", `${sha}:${rel}`], this.home);
          return r.stdout;
        } catch { /* try next status */ }
      }
    }
    throw new StorageAdapterError("E_NOT_FOUND", `git: version v${version} not found for ${name}`);
  }

  async listVersions(name: string): Promise<VersionRecord[]> {
    await this.init();
    // Collect commits touching any status path for this skill.
    const out: VersionRecord[] = [];
    const seen = new Set<string>();
    for (const s of ["published", "staging", "draft", "archived", "disabled"] as SkillStatus[]) {
      const rel = repoRelPath(name, s);
      let r;
      try {
        r = await git(["log", "--pretty=format:%H|%ad|%s", "--date=iso", "--", rel], this.home);
      } catch { continue; }
      for (const line of r.stdout.split("\n").filter(Boolean)) {
        const parts = line.split("|");
        if (parts.length < 3) continue;
        const sha = parts[0];
        const date = parts[1];
        const message = parts.slice(2).join("|");
        const m = message.match(/\[v(\d+\.\d+\.\d+)\]/);
        const version = m ? m[1] : sha.slice(0, 7);
        const key = `${version}:${sha}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ version, date, message });
      }
    }
    return out;
  }

  async diff(name: string, from: string, to: string): Promise<string> {
    await this.init();
    // Resolve to commit SHAs by scanning version-tagged commits.
    const log = await git(["log", "--all", "--pretty=format:%H|%s"], this.home);
    const lines = log.stdout.split("\n").filter(Boolean);
    const findSha = (v: string): string | undefined => {
      const tag = `[v${v}]`;
      for (const line of lines) {
        const idx = line.indexOf("|");
        const sha = line.slice(0, idx);
        const subject = line.slice(idx + 1);
        if (subject.includes(tag)) return sha;
      }
      return undefined;
    };
    const a = findSha(from);
    const b = findSha(to);
    if (!a || !b) throw new StorageAdapterError("E_NOT_FOUND", `git diff: cannot resolve v${from}..v${to}`);
    // Diff over all status paths.
    const parts: string[] = [];
    for (const s of ["published", "staging", "draft", "archived", "disabled"] as SkillStatus[]) {
      const rel = repoRelPath(name, s);
      try {
        const r = await git(["diff", a, b, "--", rel], this.home);
        if (r.stdout.trim()) parts.push(r.stdout);
      } catch { /* skip */ }
    }
    return parts.join("\n");
  }
}

function copyDirRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    const st = statSync(s);
    if (st.isDirectory()) copyDirRecursive(s, d);
    else copyFileSync(s, d);
  }
}

// Probe git availability with a short timeout.
export async function isGitAvailable(): Promise<boolean> {
  try {
    await execFileP("git", ["--version"], { timeout: GIT_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

// Suppress unused lint for findLiveStatus (kept for future use by readSkill auto-status).
void findLiveStatus;
