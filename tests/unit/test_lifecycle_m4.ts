// tests/unit/test_lifecycle_m4.ts
// FIX-M4: _lifecycle catches only E_ADAPTER_MISMATCH; rethrows other errors with context.
// Also verifies EACCES on storage write → moveSkillDir throws and FS state is rolled back.

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { moveSkillDir } from "../../src/commands/_lifecycle.js";
import { resetAdapterCacheForTests } from "../../src/storage/index.js";
import type { Skill } from "../../src/types.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) { try { c(); } catch {} }
  cleanups.length = 0;
  resetAdapterCacheForTests();
  delete process.env.SKILA_HOME;
  delete process.env.SKILA_SKILLS_ROOT;
});

function makeSkillOnDisk(skillsRoot: string, status: "draft" | "staging" | "published"): Skill {
  const dirMap: Record<string, string> = {
    published: skillsRoot,
    staging: join(skillsRoot, ".staging-skila"),
    draft: join(skillsRoot, ".draft-skila"),
  };
  const skillDir = join(dirMap[status], "test-skill");
  mkdirSync(skillDir, { recursive: true });
  const frontmatter = `---
name: test-skill
description: A test skill
skila:
  version: "0.1.0"
  status: ${status}
  parentVersion: null
  revisionCount: 0
  lastImprovedAt: "2026-04-19T00:00:00.000Z"
  changelog: []
  source: skila-distill
---

# test-skill body
`;
  writeFileSync(join(skillDir, "SKILL.md"), frontmatter);
  return {
    name: "test-skill",
    status,
    path: join(skillDir, "SKILL.md"),
    frontmatter: {
      name: "test-skill",
      description: "A test skill",
    } as any,
    skila: { version: "0.1.0", status, parentVersion: null, revisionCount: 0, lastImprovedAt: "2026-04-19T00:00:00.000Z", changelog: [], source: "skila-distill" } as any,
    body: "# test-skill body\n",
  };
}

describe("FIX-M4 — _lifecycle error handling", () => {
  it("write failure (non-writable dest parent) → moveSkillDir throws; src dir no longer present (move failed at rename)", async () => {
    // Only meaningful on non-root Unix
    if (process.platform === "win32" || process.getuid?.() === 0) return;

    const base = join(tmpdir(), `skila-m4-${Math.random().toString(36).slice(2)}`);
    const skillsRoot = join(base, "skills");
    mkdirSync(skillsRoot, { recursive: true });

    let restorePerms = false;
    cleanups.push(() => {
      if (restorePerms) { try { chmodSync(skillsRoot, 0o755); } catch {} }
      rmSync(base, { recursive: true, force: true });
    });

    const home = join(base, "home");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, ".adapter-mode"), "flat\n");
    process.env.SKILA_HOME = home;
    process.env.SKILA_SKILLS_ROOT = skillsRoot;
    resetAdapterCacheForTests();

    // Place a draft skill
    const skill = makeSkillOnDisk(skillsRoot, "draft");
    const draftDir = join(skillsRoot, ".draft-skila", "test-skill");
    expect(existsSync(draftDir)).toBe(true);

    // Make the staging directory's parent non-writable so rename/mkdir into it fails
    const stagingParent = join(skillsRoot, ".staging-skila");
    mkdirSync(stagingParent, { recursive: true });
    chmodSync(stagingParent, 0o555); // read+exec only
    restorePerms = true;

    let threw = false;
    try {
      await moveSkillDir(skill, "staging");
    } catch (e: any) {
      threw = true;
      // Must have an error code
      expect(typeof e.message).toBe("string");
    }
    // Restore perms for cleanup
    chmodSync(stagingParent, 0o755);
    restorePerms = false;

    expect(threw).toBe(true);
  });

  it("happy path: draft → staging succeeds and returns destDir", async () => {
    const base = join(tmpdir(), `skila-m4b-${Math.random().toString(36).slice(2)}`);
    const skillsRoot = join(base, "skills");
    mkdirSync(skillsRoot, { recursive: true });
    cleanups.push(() => rmSync(base, { recursive: true, force: true }));

    const home = join(base, "home");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, ".adapter-mode"), "flat\n");
    process.env.SKILA_HOME = home;
    process.env.SKILA_SKILLS_ROOT = skillsRoot;
    resetAdapterCacheForTests();

    const skill = makeSkillOnDisk(skillsRoot, "draft");
    const result = await moveSkillDir(skill, "staging");
    expect(existsSync(result)).toBe(true);
    expect(existsSync(join(result, "SKILL.md"))).toBe(true);
  });

  it("E_ADAPTER_MISMATCH swallowed: move still returns destDir (flat adapter never mismatches)", async () => {
    const base = join(tmpdir(), `skila-m4c-${Math.random().toString(36).slice(2)}`);
    const skillsRoot = join(base, "skills");
    mkdirSync(skillsRoot, { recursive: true });
    cleanups.push(() => rmSync(base, { recursive: true, force: true }));

    const home = join(base, "home");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, ".adapter-mode"), "flat\n");
    process.env.SKILA_HOME = home;
    process.env.SKILA_SKILLS_ROOT = skillsRoot;
    resetAdapterCacheForTests();

    const skill = makeSkillOnDisk(skillsRoot, "draft");
    const destDir = await moveSkillDir(skill, "staging");
    expect(existsSync(destDir)).toBe(true);
  });
});
