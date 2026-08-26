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

describe("vendor-entry.mjs is always regenerated", () => {
  // Was FIX-M12 "only write if absent". Phase 1 inverted that: the file is
  // gitignored, so a stale copy from an older checkout would silently omit
  // newer exports — which for the DOMPurify sanitizer means shipping an
  // unsanitized Markdown preview. Correctness beats the micro-optimisation.
  it("postbuild.mjs writes vendor-entry.mjs unconditionally", () => {
    const content = readFileSync(POSTBUILD_PATH, "utf8");
    expect(content).toContain("writeFileSync(entryShim, ENTRY_SHIM_SOURCE)");
    // No existsSync guard may gate that write back into place.
    expect(content).not.toContain("existsSync(entryShim)");
  });

  it("the generated shim exports the sanitizer alongside marked", () => {
    const content = readFileSync(POSTBUILD_PATH, "utf8");
    const start = content.indexOf("const ENTRY_SHIM_SOURCE");
    const end = content.indexOf("writeFileSync(entryShim, ENTRY_SHIM_SOURCE)");
    const shim = content.slice(start, end);
    expect(shim).toContain("marked");
    expect(shim).toContain("DOMPurify");
  });
});
