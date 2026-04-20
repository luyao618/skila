// tests/web/test_m13_token_env.ts
// FIX-M13: Verify hardcoded token literal is removed from ac18-screenshots.mjs
// and that token resolution logic is correct.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT_PATH = join(process.cwd(), "scripts", "ac18-screenshots.mjs");

describe("FIX-M13: no hardcoded token in ac18-screenshots.mjs", () => {
  it("script does not contain the original hardcoded token literal", () => {
    const content = readFileSync(SCRIPT_PATH, "utf8");
    // The original hardcoded token value
    expect(content).not.toContain("53181c9fbe6c4210759a200a08b130a033d84907bea094bd");
  });

  it("script reads token from process.env.SKILA_TOKEN", () => {
    const content = readFileSync(SCRIPT_PATH, "utf8");
    expect(content).toContain("SKILA_TOKEN");
    expect(content).toContain("process.env");
  });

  it("script has /api/token fallback for piped stdin", () => {
    const content = readFileSync(SCRIPT_PATH, "utf8");
    expect(content).toContain("/api/token");
    expect(content).toContain("stdin.isTTY");
  });

  it("no raw token string assignment (TOKEN = '<literal>')", () => {
    const content = readFileSync(SCRIPT_PATH, "utf8");
    // Should not have a pattern like: TOKEN = "...longstring..."
    // i.e., a 40+ char hex literal assignment
    expect(content).not.toMatch(/TOKEN\s*=\s*"[0-9a-f]{40,}"/);
  });
});
