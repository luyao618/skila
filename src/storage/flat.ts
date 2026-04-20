// FlatFileStorage (AC20). Identical interface to GitBackedStorage but uses
// a versions/<name>/v<X.Y.Z>/SKILL.md + .meta.json layout.
// All writes go through atomic.ts (AC22).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, copyFileSync, renameSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import type { SkillStatus } from "../types.js";
import type { StorageAdapter, VersionRecord, WriteSkillMetadata } from "./types.js";
import { StorageAdapterError } from "./types.js";
import { ensureSkilaHome, statusDir } from "../config/config.js";
import { atomicWriteFileSync } from "./atomic.js";
import { assertValidName, assertValidVersion } from "./validate.js";

const execFileP = promisify(execFile);

function skillPath(name: string, status: SkillStatus): string {
  return join(statusDir(status), name, "SKILL.md");
}

function findSkillPathAnyStatus(name: string): { file: string; status: SkillStatus } | undefined {
  const order: SkillStatus[] = ["draft", "staging", "published", "archived", "disabled"];
  for (const s of order) {
    const file = skillPath(name, s);
    if (existsSync(file)) return { file, status: s };
  }
  return undefined;
}

function versionsDir(name: string): string {
  return join(ensureSkilaHome(), "versions", name);
}

function versionPath(name: string, version: string): { dir: string; file: string; meta: string } {
  const dir = join(versionsDir(name), `v${version}`);
  return { dir, file: join(dir, "SKILL.md"), meta: join(dir, ".meta.json") };
}

export class FlatFileStorage implements StorageAdapter {
  readonly mode = "flat" as const;

  async init(): Promise<void> {
    mkdirSync(ensureSkilaHome(), { recursive: true });
    mkdirSync(join(ensureSkilaHome(), "versions"), { recursive: true });
  }

  async writeSkill(name: string, version: string, content: string, metadata: WriteSkillMetadata): Promise<void> {
    assertValidName(name);
    assertValidVersion(version);
    // 1. Snapshot to versions/<name>/v<version>/
    const { dir, file, meta } = versionPath(name, version);
    mkdirSync(dir, { recursive: true });
    atomicWriteFileSync(file, content);
    atomicWriteFileSync(meta, JSON.stringify({
      version,
      date: new Date().toISOString(),
      message: metadata.message,
      status: metadata.status
    }, null, 2));

    // 2. Write live SKILL.md atomically into status dir
    const live = skillPath(name, metadata.status);
    mkdirSync(dirname(live), { recursive: true });
    atomicWriteFileSync(live, content);
  }

  async moveSkill(name: string, _fromStatus: SkillStatus, toStatus: SkillStatus): Promise<void> {
    assertValidName(name);
    const located = findSkillPathAnyStatus(name);
    if (!located) throw new StorageAdapterError("E_NOT_FOUND", `flat: skill not found: ${name}`);
    const srcDir = dirname(located.file);
    const dstDir = join(statusDir(toStatus), name);
    if (srcDir === dstDir) return;
    mkdirSync(dirname(dstDir), { recursive: true });
    if (existsSync(dstDir)) rmSync(dstDir, { recursive: true, force: true });
    try {
      renameSync(srcDir, dstDir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EXDEV") {
        copyDirRecursive(srcDir, dstDir);
        rmSync(srcDir, { recursive: true, force: true });
      } else {
        throw err;
      }
    }
  }

  async readSkill(name: string, status: SkillStatus): Promise<string> {
    assertValidName(name);
    const file = skillPath(name, status);
    if (!existsSync(file)) throw new StorageAdapterError("E_NOT_FOUND", `flat: ${file} missing`);
    return readFileSync(file, "utf8");
  }

  async getVersion(name: string, version: string): Promise<string> {
    assertValidName(name);
    assertValidVersion(version);
    const { file } = versionPath(name, version);
    if (!existsSync(file)) throw new StorageAdapterError("E_NOT_FOUND", `flat: version v${version} missing for ${name}`);
    return readFileSync(file, "utf8");
  }

  async listVersions(name: string): Promise<VersionRecord[]> {
    assertValidName(name);
    const root = versionsDir(name);
    if (!existsSync(root)) return [];
    const entries = readdirSync(root).filter((e) => e.startsWith("v"));
    const out: VersionRecord[] = [];
    for (const entry of entries) {
      const version = entry.slice(1);
      const meta = join(root, entry, ".meta.json");
      let date = "";
      let message = "";
      if (existsSync(meta)) {
        try {
          const m = JSON.parse(readFileSync(meta, "utf8"));
          date = m.date ?? "";
          message = m.message ?? "";
        } catch { /* ignore */ }
      } else {
        try { date = statSync(join(root, entry)).mtime.toISOString(); } catch {}
      }
      out.push({ version, date, message });
    }
    out.sort((a, b) => compareSemver(b.version, a.version));
    return out;
  }

  async diff(name: string, from: string, to: string): Promise<string> {
    assertValidName(name);
    assertValidVersion(from);
    assertValidVersion(to);
    const a = versionPath(name, from).file;
    const b = versionPath(name, to).file;
    if (!existsSync(a) || !existsSync(b)) {
      throw new StorageAdapterError("E_NOT_FOUND", `flat diff: missing version(s) for ${name}`);
    }
    try {
      const r = await execFileP("diff", ["-u", a, b], { timeout: 5000 });
      return r.stdout;
    } catch (err: any) {
      // diff exits 1 when files differ — that's success for us.
      if (err && typeof err.stdout === "string") return err.stdout;
      // Fallback: minimal manual unified diff.
      return manualUnifiedDiff(readFileSync(a, "utf8"), readFileSync(b, "utf8"), a, b);
    }
  }
}

function compareSemver(a: string, b: string): number {
  const parse = (s: string) => s.split(".").map((x) => parseInt(x, 10) || 0);
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  return aMaj !== bMaj ? aMaj - bMaj : aMin !== bMin ? aMin - bMin : aPat - bPat;
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

function manualUnifiedDiff(a: string, b: string, aLabel: string, bLabel: string): string {
  const ax = a.split(/\r?\n/);
  const bx = b.split(/\r?\n/);
  // Remove trailing empty string from split if file ends with newline
  if (ax[ax.length - 1] === "") ax.pop();
  if (bx[bx.length - 1] === "") bx.pop();

  const out: string[] = [];
  out.push(`--- ${aLabel}`);
  out.push(`+++ ${bLabel}`);

  // Build a simple diff: find ranges of differing lines and emit hunks
  const CONTEXT = 3;
  // Collect changed line indices (0-based in 'a')
  interface Change { aStart: number; aEnd: number; bStart: number; bEnd: number; }
  const changes: Change[] = [];
  let i = 0, j = 0;
  while (i < ax.length || j < bx.length) {
    if (i < ax.length && j < bx.length && ax[i] === bx[j]) { i++; j++; continue; }
    const aStart = i, bStart = j;
    // advance until lines match again (simple O(n^2) ok for our small diffs)
    let found = false;
    for (let lookahead = 1; lookahead < Math.max(ax.length, bx.length) - Math.max(i, j) + 2; lookahead++) {
      for (let di = 0; di <= lookahead; di++) {
        const dj = lookahead - di;
        if (i + di < ax.length && j + dj < bx.length && ax[i + di] === bx[j + dj]) {
          changes.push({ aStart, aEnd: i + di, bStart, bEnd: j + dj });
          i += di; j += dj;
          found = true; break;
        }
      }
      if (found) break;
    }
    if (!found) {
      // remaining lines all differ
      changes.push({ aStart, aEnd: ax.length, bStart, bEnd: bx.length });
      break;
    }
  }

  if (changes.length === 0) return out.join("\n") + "\n";

  // Merge nearby changes into hunks
  const hunks: { aStart: number; aEnd: number; bStart: number; bEnd: number }[] = [];
  for (const ch of changes) {
    const hunkAStart = Math.max(0, ch.aStart - CONTEXT);
    const hunkBStart = Math.max(0, ch.bStart - CONTEXT);
    const hunkAEnd = Math.min(ax.length, ch.aEnd + CONTEXT);
    const hunkBEnd = Math.min(bx.length, ch.bEnd + CONTEXT);
    if (hunks.length > 0) {
      const last = hunks[hunks.length - 1];
      if (hunkAStart <= last.aEnd) {
        last.aEnd = Math.max(last.aEnd, hunkAEnd);
        last.bEnd = Math.max(last.bEnd, hunkBEnd);
        continue;
      }
    }
    hunks.push({ aStart: hunkAStart, aEnd: hunkAEnd, bStart: hunkBStart, bEnd: hunkBEnd });
  }

  for (const hunk of hunks) {
    // Compute hunk contents
    const hunkLines: string[] = [];
    let ai = hunk.aStart, bi = hunk.bStart;
    while (ai < hunk.aEnd || bi < hunk.bEnd) {
      if (ai < hunk.aEnd && bi < hunk.bEnd && ax[ai] === bx[bi]) {
        hunkLines.push(` ${ax[ai]}`); ai++; bi++;
      } else {
        // emit removes then adds until lines sync
        const syncAi = changes.find(c => c.aEnd > ai && c.aStart <= ai);
        const syncBi = changes.find(c => c.bEnd > bi && c.bStart <= bi);
        if (ai < (syncAi?.aEnd ?? hunk.aEnd)) { hunkLines.push(`-${ax[ai]}`); ai++; }
        else if (bi < (syncBi?.bEnd ?? hunk.bEnd)) { hunkLines.push(`+${bx[bi]}`); bi++; }
        else { hunkLines.push(` ${ax[ai]}`); ai++; bi++; }
      }
    }
    const aCount = hunkLines.filter(l => l[0] !== "+").length;
    const bCount = hunkLines.filter(l => l[0] !== "-").length;
    out.push(`@@ -${hunk.aStart + 1},${aCount} +${hunk.bStart + 1},${bCount} @@`);
    out.push(...hunkLines);
  }

  return out.join("\n") + "\n";
}
