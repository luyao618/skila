import { describe, it, expect } from "vitest";
import { validateSkillContent, SkilaValidationError } from "../../src/validate/validate.js";

function makeRaw(version: string) {
  return `---
name: test-skill
description: A test skill for semver validation
skila:
  version: "${version}"
  status: draft
  parentVersion: null
  revisionCount: 0
  lastImprovedAt: "2026-01-01T00:00:00.000Z"
  changelog:
    - { version: "${version}", date: "2026-01-01T00:00:00.000Z", change: "Initial" }
  source: skila-distill
---

# test-skill

Body content here.
`;
}

describe("FIX-M9: semver version validation", () => {
  it("accepts a valid semver version like 1.2.3", () => {
    expect(() => validateSkillContent(makeRaw("1.2.3"))).not.toThrow();
  });

  it("accepts a valid semver with pre-release like 1.0.0-beta.1", () => {
    expect(() => validateSkillContent(makeRaw("1.0.0-beta.1"))).not.toThrow();
  });

  it("rejects NaN.NaN.NaN with validation error", () => {
    expect(() => validateSkillContent(makeRaw("NaN.NaN.NaN"))).toThrowError(SkilaValidationError);
    try {
      validateSkillContent(makeRaw("NaN.NaN.NaN"));
    } catch (e) {
      expect(e).toBeInstanceOf(SkilaValidationError);
      const err = e as SkilaValidationError;
      expect(err.errors.some(msg => msg.includes("invalid version format"))).toBe(true);
    }
  });

  it("rejects non-semver strings like 'latest'", () => {
    try {
      validateSkillContent(makeRaw("latest"));
    } catch (e) {
      expect(e).toBeInstanceOf(SkilaValidationError);
      const err = e as SkilaValidationError;
      expect(err.errors.some(msg => msg.includes("invalid version format"))).toBe(true);
    }
  });

  it("rejects version with missing patch like 1.2", () => {
    try {
      validateSkillContent(makeRaw("1.2"));
    } catch (e) {
      expect(e).toBeInstanceOf(SkilaValidationError);
      const err = e as SkilaValidationError;
      expect(err.errors.some(msg => msg.includes("invalid version format"))).toBe(true);
    }
  });
});
