// Atomic writes via tmp file + fs.rename. POSIX rename is atomic; on EXDEV
// fall back to copyFile + unlink (still single-file resolution from reader).

import { writeFileSync, renameSync, copyFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { randomBytes } from "node:crypto";

export function atomicWriteFileSync(target: string, data: string | Buffer): void {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = join(dirname(target), `.${basename(target)}.tmp-${randomBytes(6).toString("hex")}`);
  writeFileSync(tmp, data);
  try {
    renameSync(tmp, target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EXDEV") {
      copyFileSync(tmp, target);
      try { unlinkSync(tmp); } catch { /* best-effort */ }
    } else {
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best-effort */ }
      throw err;
    }
  }
}
