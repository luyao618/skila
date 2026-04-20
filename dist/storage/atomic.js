// Atomic writes via tmp file + fs.rename. POSIX rename is atomic; on EXDEV
// fall back to copyFile + unlink (still single-file resolution from reader).
import { writeFileSync, copyFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import * as nodeFs from "node:fs";
import { dirname, join, basename } from "node:path";
import { randomBytes } from "node:crypto";
// Exported so tests can inject a mock renameSync without vi.spyOn on frozen ESM namespace.
export const _ops = {
    renameSync: nodeFs.renameSync
};
export function atomicWriteFileSync(target, data) {
    mkdirSync(dirname(target), { recursive: true });
    const tmp = join(dirname(target), `.${basename(target)}.tmp-${randomBytes(6).toString("hex")}`);
    writeFileSync(tmp, data);
    try {
        _ops.renameSync(tmp, target);
    }
    catch (err) {
        const code = err.code;
        if (code === "EXDEV") {
            copyFileSync(tmp, target);
            try {
                unlinkSync(tmp);
            }
            catch { /* best-effort */ }
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
}
//# sourceMappingURL=atomic.js.map