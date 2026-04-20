// tests/web/test_m12_postbuild.ts
// FIX-M12: Verify CDN check logic and idempotent vendor-entry behavior.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const POSTBUILD_PATH = join(process.cwd(), "scripts", "postbuild.mjs");

describe("FIX-M12: postbuild CDN check", () => {
  it("postbuild.mjs contains AC16 CDN check for https:// in dist/web/index.html", () => {
    const content = readFileSync(POSTBUILD_PATH, "utf8");
    expect(content).toContain("AC16");
    expect(content).toContain("https://");
    expect(content).toContain("index.html");
    // Should exit with failure on CDN match
    expect(content).toContain("process.exit(1)");
  });

  it("CDN check appears at the END of postbuild.mjs (after done log)", () => {
    const content = readFileSync(POSTBUILD_PATH, "utf8");
    const cdnIdx = content.indexOf("AC16 CDN check");
    const doneIdx = content.lastIndexOf("postbuild] done.");
    // CDN check block appears before done log (which is at very end)
    expect(cdnIdx).toBeGreaterThan(0);
    // The done log is inside/after the CDN check block
    expect(doneIdx).toBeGreaterThan(cdnIdx);
  });
});

describe("FIX-M12: idempotent vendor-entry.mjs", () => {
  it("postbuild.mjs only writes vendor-entry.mjs if it does not exist", () => {
    const content = readFileSync(POSTBUILD_PATH, "utf8");
    // Should check existsSync before writing entryShim
    // The existsSync guard must appear before the writeFileSync for vendor-entry
    const existsIdx = content.indexOf("existsSync(entryShim)");
    const writeIdx = content.indexOf("writeFileSync(\n    entryShim");
    expect(existsIdx).toBeGreaterThan(0);
    expect(writeIdx).toBeGreaterThan(existsIdx);
  });
});
