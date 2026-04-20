// tests/feedback/test_redact_allowlist.ts
// FIX-M21: collector sanitizeRawPayload allowlist + secret redaction.

import { describe, it, expect } from "vitest";
import { sanitizeRawPayload } from "../../src/feedback/collector.js";

describe("FIX-M21 — sanitizeRawPayload allowlist + redaction", () => {
  it("drops fields outside the allowlist", () => {
    const out = sanitizeRawPayload({
      event: "PostToolUse",
      tool: "Bash",
      skill: "azure-pipeline-debug",
      session: "abc",
      // these MUST be dropped
      tool_input: { command: "echo hi" },
      tool_response: "secret data here",
      arbitrary: { nested: "data" },
    });
    expect(out.event).toBe("PostToolUse");
    expect(out.tool).toBe("Bash");
    expect(out.skill).toBe("azure-pipeline-debug");
    expect(out.session).toBe("abc");
    expect((out as any).tool_input).toBeUndefined();
    expect((out as any).tool_response).toBeUndefined();
    expect((out as any).arbitrary).toBeUndefined();
  });

  it("redacts AWS access key in retained string fields", () => {
    const out = sanitizeRawPayload({
      skill: "session AKIAIOSFODNN7EXAMPLE leaked",
    });
    expect(out.skill).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out.skill).toContain("[REDACTED]");
  });

  it("redacts OpenAI / sk- API keys", () => {
    const out = sanitizeRawPayload({
      tool: "key sk-proj-abcdef0123456789ABCDEF0123 used",
    });
    expect(out.tool).not.toContain("sk-proj-abcdef0123456789ABCDEF0123");
    expect(out.tool).toContain("[REDACTED]");
  });

  it("redacts GitHub PAT", () => {
    const out = sanitizeRawPayload({
      session: "tok ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345 ok",
    });
    expect(out.session).not.toContain("ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345");
    expect(out.session).toContain("[REDACTED]");
  });

  it("redacts PEM private key markers", () => {
    const out = sanitizeRawPayload({
      event: "blah -----BEGIN RSA PRIVATE KEY----- payload",
    });
    expect(out.event).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(out.event).toContain("[REDACTED]");
  });

  it("normalizes invalid outcome to undefined (not 'banana')", () => {
    const out = sanitizeRawPayload({
      result: { outcome: "banana", success: true },
    });
    expect(out.result?.outcome).toBeUndefined();
    expect(out.result?.success).toBe(true);
  });

  it("returns empty object for non-object input", () => {
    expect(sanitizeRawPayload(null)).toEqual({});
    expect(sanitizeRawPayload(undefined)).toEqual({});
    expect(sanitizeRawPayload("string")).toEqual({});
    expect(sanitizeRawPayload(42)).toEqual({});
  });
});
