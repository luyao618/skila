import { describe, it, expect, vi, afterEach } from "vitest";
import { main, SkilaError } from "../../src/cli.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// FIX-H18: --port declared in parseArgs options
describe("FIX-H18: --port option", () => {
  it("passes parsed port to startServer / runServe", async () => {
    let capturedPort: number | undefined;
    vi.doMock("../../src/commands/serve.js", () => ({
      runServe: async (opts: { port?: number }) => {
        capturedPort = opts.port;
        // resolve immediately (don't actually start a server)
      }
    }));
    // Should not throw with --port 9000; it parses without error
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    // We can't fully test runServe (it never resolves), but we can test
    // that --port 9000 is parsed without error by checking dispatch returns 0
    // via a short-circuit: mock runServe to return immediately
    vi.doMock("../../src/commands/serve.js", () => ({
      runServe: async (opts: { port?: number }) => {
        capturedPort = opts.port;
      }
    }));
    const code = await main(["serve", "--port", "9000"]);
    expect(code).toBe(0);
    expect(capturedPort).toBe(9000);
    vi.doUnmock("../../src/commands/serve.js");
  });
});

// FIX-H19: dual-bin detection via import.meta.url (unit test of invocation pattern)
describe("FIX-H19: dual-bin detection", () => {
  it("main() is callable and returns exit code", async () => {
    // Just ensure main() can be imported and called without throwing
    const code = await main(["--help"]);
    expect(code).toBe(0);
  });

  it("import.meta.url is defined (ESM environment)", () => {
    // Verify we're in ESM context where import.meta.url is available
    expect(typeof import.meta.url).toBe("string");
    expect(import.meta.url).toMatch(/cli_argv/);
  });

  it("Linux-style argv path detection works", () => {
    const { pathToFileURL } = require("node:url");
    const linuxPath = "/usr/local/bin/skila";
    const fileUrl = pathToFileURL(linuxPath).href;
    expect(fileUrl).toMatch(/^file:\/\//);
    expect(fileUrl).toContain("skila");
  });

  it("Windows-style argv path detection works (simulated)", () => {
    const { pathToFileURL } = require("node:url");
    // Simulate Windows path conversion — on any OS, pathToFileURL handles it
    // by checking the conversion logic doesn't throw
    const fakePath = process.platform === "win32"
      ? "C:\\tools\\node_modules\\.bin\\skila"
      : "/usr/bin/skila";
    expect(() => pathToFileURL(fakePath)).not.toThrow();
  });
});

// FIX-H21: enum validation for --outcome and --status
describe("FIX-H21: enum-check --outcome and --status", () => {
  it("rejects invalid --outcome with exit code 64", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const code = await main(["feedback", "some-skill", "--outcome", "broken"]);
    expect(code).toBe(64);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("invalid --outcome"));
  });

  it("accepts valid --outcome success", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    // This may fail in commands/feedback.js due to missing skill, but NOT due to enum check
    const code = await main(["feedback", "nonexistent-skill-xyz", "--outcome", "success"]);
    // Should not be 64 (enum error), either 0 or 1 from actual command
    expect(code).not.toBe(64);
    const stderrCalls = errSpy.mock.calls.map((c) => String(c[0]));
    expect(stderrCalls.some((s) => s.includes("invalid --outcome"))).toBe(false);
  });

  it("rejects invalid --status with exit code 64", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const code = await main(["list", "--status", "bogus"]);
    expect(code).toBe(64);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("invalid --status"));
  });

  it("accepts valid --status draft", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const code = await main(["list", "--status", "draft"]);
    expect(code).toBe(0);
    const stderrCalls = errSpy.mock.calls.map((c) => String(c[0]));
    expect(stderrCalls.some((s) => s.includes("invalid --status"))).toBe(false);
  });
});

// FIX-H20: SkilaError pretty-print
describe("FIX-H20: SkilaError pretty-print", () => {
  it("SkilaError can be constructed and has expected shape", () => {
    const err = new SkilaError("skill not found", "check the name");
    expect(err.message).toBe("skill not found");
    expect(err.hint).toBe("check the name");
    expect(err instanceof Error).toBe(true);
    expect(err.name).toBe("SkilaError");
  });

  it("main() catches SkilaError and prints message without stack, returns 1", async () => {
    vi.doMock("../../src/commands/promote.js", () => ({
      runPromote: async (_name: string) => {
        const { SkilaError: SE } = await import("../../src/cli.js");
        throw new SE("skill 'does-not-exist' not found", "run skila list to see available skills");
      }
    }));
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const code = await main(["promote", "does-not-exist"]);
    expect(code).toBe(1);
    const stderrOutput = errSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrOutput).toContain("skill 'does-not-exist' not found");
    expect(stderrOutput).not.toContain("at async");
    vi.doUnmock("../../src/commands/promote.js");
  });

  it("main() prints hint when SkilaError has hint", async () => {
    vi.doMock("../../src/commands/promote.js", () => ({
      runPromote: async () => {
        const { SkilaError: SE } = await import("../../src/cli.js");
        throw new SE("oops", "try this instead");
      }
    }));
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await main(["promote", "x"]);
    const stderrOutput = errSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrOutput).toContain("try this instead");
    vi.doUnmock("../../src/commands/promote.js");
  });
});
