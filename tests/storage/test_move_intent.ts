// FIX-H7: moveSkill intent log + crash recovery
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resetAdapterCacheForTests,
  moveIntentPath,
  moveSkillWithIntentLog,
  recoverMoveIntent,
  readMoveIntent,
} from "../../src/storage/index.js";
import { FlatFileStorage } from "../../src/storage/flat.js";
import { StorageAdapterError } from "../../src/storage/types.js";

let home: string;
let skillsRoot: string;
let savedHome: string | undefined;
let savedSkillsRoot: string | undefined;
let savedForceAdapter: string | undefined;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "skila-h7-"));
  home = join(base, "skila-data");
  skillsRoot = join(base, "skills");
  mkdirSync(home, { recursive: true });
  mkdirSync(skillsRoot, { recursive: true });

  savedHome = process.env.SKILA_HOME;
  savedSkillsRoot = process.env.SKILA_SKILLS_ROOT;
  savedForceAdapter = process.env.SKILA_FORCE_ADAPTER;

  process.env.SKILA_HOME = home;
  process.env.SKILA_SKILLS_ROOT = skillsRoot;
  process.env.SKILA_FORCE_ADAPTER = "flat";

  resetAdapterCacheForTests();
});

afterEach(() => {
  process.env.SKILA_HOME = savedHome;
  process.env.SKILA_SKILLS_ROOT = savedSkillsRoot;
  process.env.SKILA_FORCE_ADAPTER = savedForceAdapter;
  resetAdapterCacheForTests();
  try { rmSync(join(home, ".."), { recursive: true, force: true }); } catch {}
});

async function makeAdapter(): Promise<FlatFileStorage> {
  const a = new FlatFileStorage();
  await a.init();
  return a;
}

async function writeTestSkill(adapter: FlatFileStorage, name: string, status: "draft" | "staging" | "published") {
  await adapter.writeSkill(name, "1.0.0", `# ${name}`, { message: "init", status });
}

describe("FIX-H7: moveSkill intent log + recovery", () => {
  it("writes .move-intent.json before move and clears it on success", async () => {
    const adapter = await makeAdapter();
    await writeTestSkill(adapter, "foo", "draft");

    const intentFile = moveIntentPath(home);
    expect(existsSync(intentFile)).toBe(false);

    await moveSkillWithIntentLog(adapter, "foo", "draft", "staging");

    // Intent should be cleared after success
    expect(existsSync(intentFile)).toBe(false);
  });

  it("leaves .move-intent.json when move throws (simulating crash)", async () => {
    const adapter = await makeAdapter();
    await writeTestSkill(adapter, "bar", "draft");

    // Intercept moveSkill to simulate crash between phases
    const origMove = adapter.moveSkill.bind(adapter);
    let crashed = false;
    adapter.moveSkill = async (name, from, to) => {
      crashed = true;
      throw new StorageAdapterError("E_SIMULATED_CRASH", "crash mid-move");
    };

    let err: any = null;
    try {
      await moveSkillWithIntentLog(adapter, "bar", "draft", "staging");
    } catch (e) {
      err = e;
    }

    expect(crashed).toBe(true);
    expect(err).not.toBeNull();
    // Intent file must still exist (for recovery on next init)
    const intentFile = moveIntentPath(home);
    expect(existsSync(intentFile)).toBe(true);
    const intent = readMoveIntent(home);
    expect(intent?.name).toBe("bar");
    expect(intent?.fromStatus).toBe("draft");
    expect(intent?.toStatus).toBe("staging");

    // Restore and recover
    adapter.moveSkill = origMove;
    await recoverMoveIntent(adapter, home);

    // After recovery, intent file should be gone
    expect(existsSync(intentFile)).toBe(false);
  });

  it("recoverMoveIntent completes the move if not yet done", async () => {
    const adapter = await makeAdapter();
    await writeTestSkill(adapter, "baz", "draft");

    // Simulate crash: write intent manually without moving
    const intentFile = moveIntentPath(home);
    writeFileSync(intentFile, JSON.stringify({
      name: "baz",
      fromStatus: "draft",
      toStatus: "staging",
      ts: new Date().toISOString(),
    }));

    // Verify skill is still in draft
    const draftSkillPath = join(skillsRoot, ".draft-skila", "baz", "SKILL.md");
    expect(existsSync(draftSkillPath)).toBe(true);

    // Recover
    await recoverMoveIntent(adapter, home);

    // Intent cleared
    expect(existsSync(intentFile)).toBe(false);

    // Skill now in staging
    const stagingSkillPath = join(skillsRoot, ".staging-skila", "baz", "SKILL.md");
    expect(existsSync(stagingSkillPath)).toBe(true);
  });

  it("recoverMoveIntent is a no-op when intent file absent", async () => {
    const adapter = await makeAdapter();
    // No intent file — recovery should not throw
    await expect(recoverMoveIntent(adapter, home)).resolves.toBeUndefined();
  });

  it("getAdapter() auto-recovers a pending intent on init (AC #2)", async () => {
    // First create the skill via a fresh adapter, then write a pending intent.
    const seed = await makeAdapter();
    await writeTestSkill(seed, "qux", "draft");
    resetAdapterCacheForTests();

    // Write sentinel so getAdapter() takes the sentinel branch (FIX-C6 guard
    // would otherwise reject because versions/ now exists in home).
    const { sentinelPath } = await import("../../src/storage/index.js");
    writeFileSync(sentinelPath(home), "flat\n");

    const intentFile = moveIntentPath(home);
    writeFileSync(intentFile, JSON.stringify({
      name: "qux",
      fromStatus: "draft",
      toStatus: "staging",
      ts: new Date().toISOString(),
    }));

    // getAdapter() should trigger recoverMoveIntent automatically.
    const { getAdapter } = await import("../../src/storage/index.js");
    await getAdapter();

    expect(existsSync(intentFile)).toBe(false);
    const stagingSkillPath = join(skillsRoot, ".staging-skila", "qux", "SKILL.md");
    expect(existsSync(stagingSkillPath)).toBe(true);
  });
});
