import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { join, basename } from "node:path";
import { makeEnv } from "../_helpers.js";
import { runDistill } from "../../src/commands/distill.js";
import { runPromote } from "../../src/commands/promote.js";
import { runGraduate } from "../../src/commands/graduate.js";
import { runReject } from "../../src/commands/reject.js";
import { recordInvocation } from "../../src/feedback/store.js";
import { maybeAutoPromote } from "../../src/promote/auto.js";
import { statusDir } from "../../src/config/config.js";
import { findSkill } from "../../src/inventory/scanner.js";

let env: ReturnType<typeof makeEnv>;
afterEach(() => env?.cleanup());

describe("AC10 — two-tier promotion", () => {
  it("distill → .draft-skila/ (NOT published)", async () => {
    env = makeEnv();
    const fixture = join(process.cwd(), "tests", "fixtures", "sessions", "session-1.md");
    const r = await runDistill({ fromFixture: fixture });
    expect(r.draftPath).toMatch(/\.draft-skila\//);
    expect(basename(r.draftPath!)).toBe("SKILL.md");
    // CC loader visibility: dir starts with '.'
    expect(r.draftPath!.includes("/.draft-skila/")).toBe(true);
  });

  it("auto-promote (≥10 invocations OR ≥1 failure) → .staging-skila/", async () => {
    env = makeEnv();
    const fixture = join(process.cwd(), "tests", "fixtures", "sessions", "session-1.md");
    const r = await runDistill({ fromFixture: fixture });
    const name = r.proposal.name;
    // 1 failure should hit the floor
    await recordInvocation(name, "failure");
    const promoted = await maybeAutoPromote(name);
    expect(promoted.promoted).toBe(true);
    const post = findSkill(name);
    expect(post?.status).toBe("staging");
    expect(post?.path.includes("/.staging-skila/")).toBe(true);
  });

  it("graduate: staging → published", async () => {
    env = makeEnv();
    const fixture = join(process.cwd(), "tests", "fixtures", "sessions", "session-1.md");
    const r = await runDistill({ fromFixture: fixture });
    const name = r.proposal.name;
    await recordInvocation(name, "failure");
    await maybeAutoPromote(name);
    await runGraduate(name);
    const post = findSkill(name);
    expect(post?.status).toBe("published");
    expect(post?.path.includes("/.staging-skila/")).toBe(false);
    expect(post?.path.includes("/.draft-skila/")).toBe(false);
  });

  it("reject: staging → archived", async () => {
    env = makeEnv();
    const fixture = join(process.cwd(), "tests", "fixtures", "sessions", "session-1.md");
    const r = await runDistill({ fromFixture: fixture });
    const name = r.proposal.name;
    await recordInvocation(name, "failure");
    await maybeAutoPromote(name);
    await runReject(name);
    const post = findSkill(name);
    expect(post?.status).toBe("archived");
  });
});
