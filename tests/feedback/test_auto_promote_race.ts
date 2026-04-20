// tests/feedback/test_auto_promote_race.ts
// FIX-H3: 50 concurrent maybeAutoPromote(name) calls → exactly 1 successful move; rest no-op.

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeEnv } from "../_helpers.js";
import { maybeAutoPromote } from "../../src/promote/auto.js";
import { recordInvocation } from "../../src/feedback/store.js";
import { statusDir } from "../../src/config/config.js";

let env: ReturnType<typeof makeEnv>;
afterEach(() => env?.cleanup());

/** Create a minimal draft skill directory with SKILL.md */
function createDraftSkill(skillsRoot: string, name: string): void {
  const draftDir = join(skillsRoot, ".draft-skila", name);
  mkdirSync(draftDir, { recursive: true });
  const skillMd = `---
name: ${name}
description: Test skill for auto-promote race test.
compatibility:
  node: ">=20"
skila:
  version: 0.1.0
  status: draft
  parentVersion: null
  revisionCount: 0
  lastImprovedAt: "2026-04-20T00:00:00Z"
  changelog:
    - { version: 0.1.0, date: "2026-04-20T00:00:00Z", change: "Initial draft" }
  source: skila-distill
---
# ${name}

Test skill body.
`;
  writeFileSync(join(draftDir, "SKILL.md"), skillMd, "utf8");
}

describe("FIX-H3 — auto-promote race lockfile + idempotency", () => {
  it("50 concurrent maybeAutoPromote calls result in exactly 1 successful move", async () => {
    env = makeEnv();
    const name = "race-test-skill";

    // Create the draft skill in the test skills root
    createDraftSkill(env.skillsRoot, name);

    // Record enough invocations to meet the promotion floor (≥10)
    for (let i = 0; i < 10; i++) {
      await recordInvocation(name, "success");
    }

    // Fire 50 concurrent auto-promote calls
    const results = await Promise.all(
      Array.from({ length: 50 }, () => maybeAutoPromote(name))
    );

    const promoted = results.filter((r) => r.promoted);
    const notPromoted = results.filter((r) => !r.promoted);

    expect(promoted).toHaveLength(1);
    expect(notPromoted).toHaveLength(49);

    // Verify the staging directory now contains the skill
    const stagingDest = join(statusDir("staging"), name);
    const { existsSync } = await import("node:fs");
    expect(existsSync(stagingDest)).toBe(true);
    expect(existsSync(join(stagingDest, "SKILL.md"))).toBe(true);
  });

  it("maybeAutoPromote is idempotent when called again after promotion", async () => {
    env = makeEnv();
    const name = "idempotent-skill";

    createDraftSkill(env.skillsRoot, name);

    for (let i = 0; i < 10; i++) {
      await recordInvocation(name, "success");
    }

    const first = await maybeAutoPromote(name);
    expect(first.promoted).toBe(true);

    // Second call: skill is now in staging, not draft — should no-op
    const second = await maybeAutoPromote(name);
    expect(second.promoted).toBe(false);
  });
});
