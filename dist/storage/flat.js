// FlatFileStorage (AC20). Identical interface to GitBackedStorage but uses
// a versions/<name>/v<X.Y.Z>/SKILL.md + .meta.json layout.
// All writes go through atomic.ts (AC22).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, copyFileSync, renameSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { StorageAdapterError } from "./types.js";
import { ensureSkilaHome, statusDir } from "../config/config.js";
import { atomicWriteFileSync } from "./atomic.js";
import { sidecarPathFor, serializeSidecar, SIDECAR_FILENAME } from "../inventory/sidecar.js";
const execFileP = promisify(execFile);
function skillPath(name, status) {
    return join(statusDir(status), name, "SKILL.md");
}
function findSkillPathAnyStatus(name) {
    const order = ["draft", "staging", "published", "archived", "disabled"];
    for (const s of order) {
        const file = skillPath(name, s);
        if (existsSync(file))
            return { file, status: s };
    }
    return undefined;
}
function versionsDir(name) {
    return join(ensureSkilaHome(), "versions", name);
}
function versionPath(name, version) {
    const dir = join(versionsDir(name), `v${version}`);
    return { dir, file: join(dir, "SKILL.md"), meta: join(dir, ".meta.json") };
}
export class FlatFileStorage {
    mode = "flat";
    async init() {
        mkdirSync(ensureSkilaHome(), { recursive: true });
        mkdirSync(join(ensureSkilaHome(), "versions"), { recursive: true });
    }
    async writeSkill(name, version, content, metadata) {
        // 1. Snapshot to versions/<name>/v<version>/ — both SKILL.md and sidecar.
        const { dir, file, meta } = versionPath(name, version);
        mkdirSync(dir, { recursive: true });
        atomicWriteFileSync(file, content);
        atomicWriteFileSync(meta, JSON.stringify({
            version,
            date: new Date().toISOString(),
            message: metadata.message,
            status: metadata.status
        }, null, 2));
        let sidecarBytes;
        if (metadata.sidecar) {
            sidecarBytes = serializeSidecar(metadata.sidecar);
            atomicWriteFileSync(join(dir, SIDECAR_FILENAME), sidecarBytes);
        }
        // 2. Write live SKILL.md atomically into status dir (and the sidecar).
        const live = skillPath(name, metadata.status);
        mkdirSync(dirname(live), { recursive: true });
        atomicWriteFileSync(live, content);
        if (sidecarBytes) {
            atomicWriteFileSync(sidecarPathFor(live), sidecarBytes);
        }
    }
    async moveSkill(name, _fromStatus, toStatus) {
        const located = findSkillPathAnyStatus(name);
        if (!located)
            throw new StorageAdapterError("E_NOT_FOUND", `flat: skill not found: ${name}`);
        const srcDir = dirname(located.file);
        const dstDir = join(statusDir(toStatus), name);
        if (srcDir === dstDir)
            return;
        mkdirSync(dirname(dstDir), { recursive: true });
        if (existsSync(dstDir))
            rmSync(dstDir, { recursive: true, force: true });
        try {
            renameSync(srcDir, dstDir);
        }
        catch (err) {
            const code = err.code;
            if (code === "EXDEV") {
                copyDirRecursive(srcDir, dstDir);
                rmSync(srcDir, { recursive: true, force: true });
            }
            else {
                throw err;
            }
        }
    }
    async readSkill(name, status) {
        const file = skillPath(name, status);
        if (!existsSync(file))
            throw new StorageAdapterError("E_NOT_FOUND", `flat: ${file} missing`);
        return readFileSync(file, "utf8");
    }
    async getVersion(name, version) {
        const { file } = versionPath(name, version);
        if (!existsSync(file))
            throw new StorageAdapterError("E_NOT_FOUND", `flat: version v${version} missing for ${name}`);
        return readFileSync(file, "utf8");
    }
    async listVersions(name) {
        const root = versionsDir(name);
        if (!existsSync(root))
            return [];
        const entries = readdirSync(root).filter((e) => e.startsWith("v"));
        const out = [];
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
                }
                catch { /* ignore */ }
            }
            else {
                try {
                    date = statSync(join(root, entry)).mtime.toISOString();
                }
                catch { }
            }
            out.push({ version, date, message });
        }
        out.sort((a, b) => (a.date < b.date ? 1 : -1));
        return out;
    }
    async writeFile(name, relativePath, content, _opts) {
        if (relativePath === "SKILL.md" || relativePath.endsWith("/SKILL.md")) {
            throw new StorageAdapterError("E_USE_WRITE_SKILL", "use writeSkill() for SKILL.md (frontmatter validation + version bump)");
        }
        if (relativePath.includes("..")) {
            throw new StorageAdapterError("E_BAD_PATH", `path traversal not allowed: ${relativePath}`);
        }
        const located = findSkillPathAnyStatus(name);
        if (!located)
            throw new StorageAdapterError("E_NOT_FOUND", `flat: skill not found: ${name}`);
        const target = join(dirname(located.file), relativePath);
        mkdirSync(dirname(target), { recursive: true });
        atomicWriteFileSync(target, content);
    }
    async diff(name, from, to) {
        const a = versionPath(name, from).file;
        const b = versionPath(name, to).file;
        if (!existsSync(a) || !existsSync(b)) {
            throw new StorageAdapterError("E_NOT_FOUND", `flat diff: missing version(s) for ${name}`);
        }
        try {
            const r = await execFileP("diff", ["-u", a, b], { timeout: 5000 });
            return r.stdout;
        }
        catch (err) {
            // diff exits 1 when files differ — that's success for us.
            if (err && typeof err.stdout === "string")
                return err.stdout;
            // Fallback: minimal manual unified diff.
            return manualUnifiedDiff(readFileSync(a, "utf8"), readFileSync(b, "utf8"), a, b);
        }
    }
}
function copyDirRecursive(src, dst) {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src)) {
        const s = join(src, entry);
        const d = join(dst, entry);
        const st = statSync(s);
        if (st.isDirectory())
            copyDirRecursive(s, d);
        else
            copyFileSync(s, d);
    }
}
function manualUnifiedDiff(a, b, aLabel, bLabel) {
    const ax = a.split(/\r?\n/);
    const bx = b.split(/\r?\n/);
    const out = [];
    out.push(`--- ${aLabel}`);
    out.push(`+++ ${bLabel}`);
    const max = Math.max(ax.length, bx.length);
    for (let i = 0; i < max; i++) {
        if (ax[i] === bx[i])
            continue;
        if (ax[i] !== undefined)
            out.push(`-${ax[i]}`);
        if (bx[i] !== undefined)
            out.push(`+${bx[i]}`);
    }
    return out.join("\n") + "\n";
}
//# sourceMappingURL=flat.js.map