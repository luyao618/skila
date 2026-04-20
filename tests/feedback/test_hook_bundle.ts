import { describe, it, expect } from "vitest";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd());
const BUNDLE = join(ROOT, "dist", "hooks", "feedback-entry.cjs");

describe("FIX-H23 — feedback-entry.cjs bundle exists after build", () => {
  it("dist/hooks/feedback-entry.cjs exists", () => {
    expect(existsSync(BUNDLE)).toBe(true);
  });

  it("bundle size < 100KB", () => {
    const { size } = statSync(BUNDLE);
    expect(size).toBeLessThan(100 * 1024);
  });
});
