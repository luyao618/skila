import { describe, it, expect, afterEach } from "vitest";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { makeEnv } from "../_helpers.js";
import { runDistill } from "../../src/commands/distill.js";
import { parseSkillFile } from "../../src/inventory/frontmatter.js";
import { readSidecar } from "../../src/inventory/sidecar.js";

let env: ReturnType<typeof makeEnv>;
afterEach(() => env?.cleanup());

describe("AC8 — append-and-revise", () => {
  it("session-2 yields UPDATE→azure-pipeline-debug v0.1.0 → v0.2.0 with parentVersion + non-empty changelog", async () => {
    env = makeEnv({ withFixtureSkill: true });
    const fixture = join(process.cwd(), "tests", "fixtures", "sessions", "session-2.md");
    const result = await runDistill({ fromFixture: fixture });
    expect(result.proposal.mode).toBe("UPDATE");
    expect(result.proposal.targetName).toBe("azure-pipeline-debug");
    expect(result.proposal.parentVersion).toBe("0.1.0");
    expect(result.proposal.newVersion).toBe("0.2.0");
    expect(result.draftPath).toMatch(/\.draft-skila\/azure-pipeline-debug\/SKILL\.md$/);
    const raw = readFileSync(result.draftPath!, "utf8");
    parseSkillFile(raw); // sanity: still parses
    const sidecar = readSidecar(result.draftPath!);
    expect(sidecar.parentVersion).toBe("0.1.0");
    expect(sidecar.changelog.length).toBeGreaterThan(0);
    expect(sidecar.changelog[0].change).toMatch(/session-2/);
    // SKILL.md should NOT contain a legacy skila: block
    expect(raw).not.toMatch(/^skila:/m);
    void dirname;
  });
});

