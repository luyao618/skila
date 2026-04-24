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
import { sidecarPathFor, serializeSidecar, SIDECAR_FILENAME } from "../inventory/sidecar.js";
import { assertValidName, assertValidVersion } from "./validate.js";

const execFileP = promisify(execFile);
const GIT_TIMEOUT_MS = 5000;

// Standard -c flags to disable GPG signing and set identity for all commits.
const GIT_COMMIT_FLAGS = [
  "-c", "commit.gpgsign=false",
  "-c", "user.email=skila@local",
  "-c", "user.name=skila",
];

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

// Run a commit with the standard -c flags to suppress signing and set identity.
async function gitCommit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return git([...GIT_COMMIT_FLAGS, "commit", ...args], cwd);
}

function repoRelPath(name: string, status: SkillStatus): string {
  return join("skills", status, name, "SKILL.md");
}

function liveSkillPath(name: string, status: SkillStatus): string {
  return join(statusDir(status), name, "SKILL.md");
}

function findLiveStatus(name: string): SkillStatus | undefined {
  const order: SkillStatus[] = ["draft", "staging", "published", "archived"];
  for (const s of order) {
    if (existsSync(liveSkillPath(name, s))) return s;
  }
  return undefined;
}

// Check if a git repo has any commits (i.e. HEAD resolves).
async function hasAnyCommit(home: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--verify", "HEAD"], home);
    return true;
  } catch {
    return false;
  }
}

// .gitignore content for sentinel / temp files.
const GITIGNORE_CONTENT = [
  "# skila sentinel and temp files — do not track",
  ".adapter-mode",
  ".write-probe",
  ".*.tmp-*",
  ".move-intent.json",
  ".promote-*.lock",
  ".skila-init",
  "",
].join("\n");

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
      // Write .gitignore for sentinel/temp files (FIX-M7).
      atomicWriteFileSync(join(home, ".gitignore"), GITIGNORE_CONTENT);
      await git(["add", "--", ".gitignore"], home);
      // initial commit so HEAD exists
      const seed = join(home, ".skila-init");
      atomicWriteFileSync(seed, `skila storage init ${new Date().toISOString()}\n`);
      // Force-add .skila-init even though it's in .gitignore — it serves as a
      // skila-repo marker for the foreign-repo guard (FIX-H8).
      await git(["add", "-f", "--", ".skila-init"], home);
      await gitCommit(["-q", "-m", "skila: storage init"], home);
    } else {
      // FIX-H8: foreign-repo guard. If .git exists but was not created by skila,
      // refuse with E_GIT_FOREIGN_REPO.
      if (await hasAnyCommit(home)) {
        // A skila repo always has at least one commit touching .skila-init.
        const skilaLog = await git(
          ["log", "--max-count=1", "--pretty=format:%H", "--", ".skila-init"],
          home
        );
        if (!skilaLog.stdout.trim()) {
          throw new StorageAdapterError(
            "E_GIT_FOREIGN_REPO",
            `git: ${home} contains a git repo not created by skila. ` +
            `Remove .git or use a dedicated skila home directory.`
          );
        }
      } else {
        // .git exists but no commits yet — this can happen when a test (or user)
        // pre-initialises the git repo before skila runs. Bootstrap the skila
        // sentinel files so foreign-repo checks pass on subsequent init() calls.
        atomicWriteFileSync(join(home, ".gitignore"), GITIGNORE_CONTENT);
        await git(["add", "--", ".gitignore"], home);
        const seed = join(home, ".skila-init");
        atomicWriteFileSync(seed, `skila storage init ${new Date().toISOString()}\n`);
        await git(["add", "-f", "--", ".skila-init"], home);
        await gitCommit(["-q", "-m", "skila: storage init"], home);
      }
    }
  }

  async writeSkill(name: string, version: string, content: string, metadata: WriteSkillMetadata): Promise<void> {
    assertValidName(name);
    assertValidVersion(version);
    await this.init();
    const rel = repoRelPath(name, metadata.status);
    const target = join(this.home, rel);
    mkdirSync(dirname(target), { recursive: true });
    atomicWriteFileSync(target, content);
    const addPaths = [rel];

    // Sidecar (`.skila.json`) — written and committed alongside SKILL.md.
    let sidecarRel: string | undefined;
    let sidecarBytes: string | undefined;
    if (metadata.sidecar) {
      sidecarRel = join(dirname(rel), SIDECAR_FILENAME);
      sidecarBytes = serializeSidecar(metadata.sidecar);
      const sidecarTarget = join(this.home, sidecarRel);
      atomicWriteFileSync(sidecarTarget, sidecarBytes);
      addPaths.push(sidecarRel);
    }

    await git(["add", "--", ...addPaths], this.home);
    // Tag format: [skill=<name> v<version>] (FIX-H9).
    // Allow empty-on-no-change commits so version history records the bump.
    await gitCommit(["-q", "--allow-empty", "-m", `${metadata.message} [skill=${name} v${version}]`], this.home);

    // Mirror to live skill tree (atomic) — both SKILL.md and the sidecar so
    // Claude Code reads the clean SKILL.md while skila reads the sidecar.
    const live = liveSkillPath(name, metadata.status);
    mkdirSync(dirname(live), { recursive: true });
    atomicWriteFileSync(live, content);
    if (sidecarBytes) {
      atomicWriteFileSync(sidecarPathFor(live), sidecarBytes);
    }
  }

  async moveSkill(name: string, fromStatus: SkillStatus, toStatus: SkillStatus): Promise<void> {
    assertValidName(name);
    await this.init();
    const fromRel = repoRelPath(name, fromStatus);
    const toRel = repoRelPath(name, toStatus);
    const fromAbs = join(this.home, fromRel);
    const toAbs = join(this.home, toRel);
    if (existsSync(fromAbs)) {
      mkdirSync(dirname(toAbs), { recursive: true });
      try {
        // FIX-M17: add -- end-of-options before paths.
        await git(["mv", "--", fromRel, toRel], this.home);
      } catch {
        // non-tracked file — fall back to fs rename + add, then rm source from index (FIX-H6)
        try { renameSync(fromAbs, toAbs); } catch { copyFileSync(fromAbs, toAbs); }
        await git(["add", "--", toRel], this.home);
        // Remove source from index (it may still be staged from a prior add).
        try { await git(["rm", "--cached", "--", fromRel], this.home); } catch { /* not in index — ok */ }
      }
      await gitCommit(["-q", "--allow-empty", "-m", `move ${name}: ${fromStatus}->${toStatus}`], this.home);
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
    assertValidName(name);
    const live = liveSkillPath(name, status);
    if (existsSync(live)) return readFileSync(live, "utf8");
    const repo = join(this.home, repoRelPath(name, status));
    if (existsSync(repo)) return readFileSync(repo, "utf8");
    throw new StorageAdapterError("E_NOT_FOUND", `git: skill ${name} not found in status=${status}`);
  }

  async getVersion(name: string, version: string): Promise<string> {
    assertValidName(name);
    assertValidVersion(version);
    await this.init();
    // FIX-H9: filter by path (repoRelPath) AND tag, prefer most recent.
    // Support both new tag format [skill=<name> v<version>] and legacy [v<version>].
    const newTag = `[skill=${name} v${version}]`;
    const legacyTag = `[v${version}]`;

    for (const s of ["published", "staging", "draft", "archived"] as SkillStatus[]) {
      const rel = repoRelPath(name, s);
      let log;
      try {
        // Use path-specific log so only commits touching this exact file are considered.
        log = await git(["log", "--all", "--pretty=format:%H|%s", "--", rel], this.home);
      } catch { continue; }
      const lines = log.stdout.split("\n").filter(Boolean);
      for (const line of lines) {
        const idx = line.indexOf("|");
        const sha = line.slice(0, idx);
        const subject = line.slice(idx + 1);
        if (!subject.includes(newTag) && !subject.includes(legacyTag)) continue;
        try {
          const r = await git(["show", `${sha}:${rel}`], this.home);
          return r.stdout;
        } catch { /* try next */ }
      }
    }
    throw new StorageAdapterError("E_NOT_FOUND", `git: version v${version} not found for ${name}`);
  }

  async listVersions(name: string): Promise<VersionRecord[]> {
    assertValidName(name);
    await this.init();
    // Collect commits touching any status path for this skill.
    const out: VersionRecord[] = [];
    const seen = new Set<string>();
    for (const s of ["published", "staging", "draft", "archived"] as SkillStatus[]) {
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
        // Support new tag format [skill=<name> v<version>] and legacy [v<version>].
        const m = message.match(/\[skill=\S+ v(\d+\.\d+\.\d+)\]/) || message.match(/\[v(\d+\.\d+\.\d+)\]/);
        const version = m ? m[1] : sha.slice(0, 7);
        const key = `${version}:${sha}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ version, date, message });
      }
    }
    return out;
  }

  async writeFile(name: string, relativePath: string, content: string, opts?: { message?: string }): Promise<void> {
    if (relativePath === "SKILL.md" || relativePath.endsWith("/SKILL.md")) {
      throw new StorageAdapterError("E_USE_WRITE_SKILL", "use writeSkill() for SKILL.md (frontmatter validation + version bump)");
    }
    if (relativePath.includes("..")) {
      throw new StorageAdapterError("E_BAD_PATH", `path traversal not allowed: ${relativePath}`);
    }
    await this.init();
    const status = findLiveStatus(name);
    if (!status) throw new StorageAdapterError("E_NOT_FOUND", `git: skill ${name} not found in any live status dir`);

    // Mirror to git repo path and commit
    const repoRel = join("skills", status, name, relativePath);
    const repoAbs = join(this.home, repoRel);
    mkdirSync(dirname(repoAbs), { recursive: true });
    atomicWriteFileSync(repoAbs, content);
    await git(["add", "--", repoRel], this.home);
    const message = opts?.message ?? `web-edit ${name}/${relativePath}`;
    await gitCommit(["-q", "--allow-empty", "-m", message], this.home);

    // Mirror to live tree (where the skill is actually loaded from)
    const liveAbs = join(statusDir(status), name, relativePath);
    mkdirSync(dirname(liveAbs), { recursive: true });
    atomicWriteFileSync(liveAbs, content);
  }

  async diff(name: string, from: string, to: string): Promise<string> {
    assertValidName(name);
    assertValidVersion(from);
    assertValidVersion(to);
    await this.init();
    // Resolve to commit SHAs by scanning version-tagged commits.
    const log = await git(["log", "--all", "--pretty=format:%H|%s"], this.home);
    const lines = log.stdout.split("\n").filter(Boolean);
    const findSha = (v: string): string | undefined => {
      const newTag = `[skill=${name} v${v}]`;
      const legacyTag = `[v${v}]`;
      for (const line of lines) {
        const idx = line.indexOf("|");
        const sha = line.slice(0, idx);
        const subject = line.slice(idx + 1);
        if (subject.includes(newTag) || subject.includes(legacyTag)) return sha;
      }
      return undefined;
    };
    const a = findSha(from);
    const b = findSha(to);
    if (!a || !b) throw new StorageAdapterError("E_NOT_FOUND", `git diff: cannot resolve v${from}..v${to}`);
    // Diff over all status paths.
    const parts: string[] = [];
    for (const s of ["published", "staging", "draft", "archived"] as SkillStatus[]) {
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
// (Now consumed by writeFile to locate the active status dir for supporting files.)
