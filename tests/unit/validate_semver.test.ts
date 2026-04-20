import { describe, it, expect } from "vitest";
import { validateSkilaMetadata, SkilaValidationError } from "../../src/validate/validate.js";

function makeMeta(version: string) {
  return {
    version,
    status: "draft" as const,
    parentVersion: null,
    revisionCount: 0,
    lastImprovedAt: "2026-01-01T00:00:00.000Z",
    changelog: [{ version, date: "2026-01-01T00:00:00.000Z", change: "Initial" }],
    source: "skila-distill",
  };
}

describe("FIX-M9: semver version validation (sidecar metadata)", () => {
  it("accepts a valid semver version like 1.2.3", () => {
    expect(() => validateSkilaMetadata(makeMeta("1.2.3"))).not.toThrow();
  });

  it("accepts a valid semver with pre-release like 1.0.0-beta.1", () => {
    expect(() => validateSkilaMetadata(makeMeta("1.0.0-beta.1"))).not.toThrow();
  });

  it("rejects NaN.NaN.NaN with validation error", () => {
    expect(() => validateSkilaMetadata(makeMeta("NaN.NaN.NaN"))).toThrowError(SkilaValidationError);
    try {
      validateSkilaMetadata(makeMeta("NaN.NaN.NaN"));
    } catch (e) {
      expect(e).toBeInstanceOf(SkilaValidationError);
      const err = e as SkilaValidationError;
      expect(err.errors.some(msg => msg.includes("invalid version format"))).toBe(true);
    }
  });

  it("rejects non-semver strings like 'latest'", () => {
    try {
      validateSkilaMetadata(makeMeta("latest"));
    } catch (e) {
      expect(e).toBeInstanceOf(SkilaValidationError);
      const err = e as SkilaValidationError;
      expect(err.errors.some(msg => msg.includes("invalid version format"))).toBe(true);
    }
  });

  it("rejects version with missing patch like 1.2", () => {
    try {
      validateSkilaMetadata(makeMeta("1.2"));
    } catch (e) {
      expect(e).toBeInstanceOf(SkilaValidationError);
      const err = e as SkilaValidationError;
      expect(err.errors.some(msg => msg.includes("invalid version format"))).toBe(true);
    }
  });
});
