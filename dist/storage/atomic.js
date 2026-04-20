// Atomic writes via tmp file + fs.rename. POSIX rename is atomic; on EXDEV
// fall back to copyFile + unlink (still single-file resolution from reader).
import { unlinkSync, mkdirSync, existsSync } from "node:fs";
import * as nodeFs from "node:fs";
import { dirname, join, basename } from "node:path";
import { randomBytes } from "node:crypto";
import { StorageAdapterError } from "./types.js";
// Exported so tests can inject a mock renameSync without vi.spyOn on frozen ESM namespace.
export const _ops = {
    renameSync: nodeFs.renameSync,
    openSync: nodeFs.openSync,
    writeSync: nodeFs.writeSync,
    fsyncSync: nodeFs.fsyncSync,
    closeSync: nodeFs.closeSync,
    copyFileSync: nodeFs.copyFileSync,
};
function fsyncFd(fd) {
    try {
        _ops.fsyncSync(fd);
    }
    catch (err) {
        throw new StorageAdapterError("E_FSYNC", `fsync failed: ${err.message}`, "check filesystem health");
    }
}
export function atomicWriteFileSync(target, data) {
    const dir = dirname(target);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${basename(target)}.tmp-${randomBytes(6).toString("hex")}`);
    // Write + fsync temp file
    const buf = typeof data === "string" ? Buffer.from(data) : data;
    const fd = _ops.openSync(tmp, "w");
    try {
        _ops.writeSync(fd, buf);
        fsyncFd(fd);
    }
    finally {
        try {
            _ops.closeSync(fd);
        }
        catch { /* best-effort */ }
    }
    try {
        _ops.renameSync(tmp, target);
    }
    catch (err) {
        const code = err.code;
        if (code === "EXDEV") {
            // Cross-device: copy to sibling tmp on dest filesystem, fsync, rename
            const destTmp = join(dir, `.${basename(target)}.tmp2-${randomBytes(6).toString("hex")}`);
            try {
                _ops.copyFileSync(tmp, destTmp);
                const fd2 = _ops.openSync(destTmp, "r+");
                try {
                    fsyncFd(fd2);
                }
                finally {
                    try {
                        _ops.closeSync(fd2);
                    }
                    catch { /* best-effort */ }
                }
                _ops.renameSync(destTmp, target);
                try {
                    unlinkSync(tmp);
                }
                catch { /* best-effort */ }
            }
            catch (innerErr) {
                try {
                    if (existsSync(destTmp))
                        unlinkSync(destTmp);
                }
                catch { /* best-effort */ }
                try {
                    if (existsSync(tmp))
                        unlinkSync(tmp);
                }
                catch { /* best-effort */ }
                throw innerErr;
            }
        }
        else {
            try {
                if (existsSync(tmp))
                    unlinkSync(tmp);
            }
            catch { /* best-effort */ }
            throw err;
        }
    }
    // fsync parent directory to flush the rename
    const dirFd = _ops.openSync(dir, "r");
    try {
        fsyncFd(dirFd);
    }
    finally {
        try {
            _ops.closeSync(dirFd);
        }
        catch { /* best-effort */ }
    }
}
//# sourceMappingURL=atomic.js.map