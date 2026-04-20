// Unit tests for the sidecar I/O helpers and migration.

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSidecar, readSidecarIfExists, writeSidecar, bumpAndAppend, defaultSkila, sidecarPathFor } from "../../src/inventory/sidecar.js";
import { runMigrateSidecar } from "../../src/inventory/migrate.js";
import { parseSkillFile } from "../../src/inventory/frontmatter.js";

let cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.forEach(c => { try { c(); } catch {} });
  cleanups = [];
  delete process.env.SKILA_HOME;
  delete process.env.SKILA_SKILLS_ROOT;
});

describe("sidecar read/write", () => {
  it("readSidecar returns defaults when absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "skila-sc-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const md = join(dir, "SKILL.md");
    writeFileSync(md, "---\nname: x\ndescription: y\n---\nbody\n");
    const m = readSidecar(md);
    expect(m.version).toBe("0.0.0");
    expect(m.changelog).toEqual([]);
    expect(m.status).toBe("published");
    expect(readSidecarIfExists(md)).toBeUndefined();
  });

  it("write + read round-trips populated metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "skila-sc-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const md = join(dir, "SKILL.md");
    const meta = {
      ...defaultSkila("draft"),
      version: "0.2.0",
      parentVersion: "0.1.0",
      revisionCount: 3,
      lastImprovedAt: "2026-04-20T00:00:00.000Z",
      changelog: [{ version: "0.1.0", date: "2026-01-01T00:00:00Z", change: "Initial" }],
      source: "skila-distill" as const,
    };
    writeSidecar(md, meta);
    expect(existsSync(sidecarPathFor(md))).toBe(true);
    const back = readSidecar(md);
    expect(back).toEqual(meta);
  });

  it("bumpAndAppend bumps patch and grows changelog by 1", () => {
    const meta = defaultSkila();
    meta.version = "0.1.2";
    meta.changelog = [{ version: "0.1.2", date: "t", change: "prior" }];
    const next = bumpAndAppend(meta, "new change", "user-edit-via-web");
    expect(next.version).toBe("0.1.3");
    expect(next.parentVersion).toBe("0.1.2");
    expect(next.revisionCount).toBe(1);
    expect(next.source).toBe("user-edit-via-web");
    expect(next.changelog.length).toBe(2);
    expect(next.changelog.at(-1)?.change).toBe("new change");
    expect(next.changelog.at(-1)?.version).toBe("0.1.3");
  });
});

describe("migrate-sidecar", () => {
  it("moves legacy frontmatter skila block into .skila.json and cleans SKILL.md", () => {
    const base = mkdtempSync(join(tmpdir(), "skila-mig-"));
    cleanups.push(() => rmSync(base, { recursive: true, force: true }));
    const skillsRoot = join(base, "skills");
    const home = join(base, "skila-data");
    mkdirSync(home, { recursive: true });
    process.env.SKILA_HOME = home;
    process.env.SKILA_SKILLS_ROOT = skillsRoot;

    const dir = join(skillsRoot, "legacy-skill");
    mkdirSync(dir, { recursive: true });
    const legacy = `---
name: legacy-skill
description: legacy skill with inline skila
skila:
  version: "0.3.0"
  status: published
  parentVersion: "0.2.0"
  revisionCount: 5
  lastImprovedAt: "2026-01-01T00:00:00.000Z"
  changelog:
    - { version: "0.3.0", date: "2026-01-01T00:00:00.000Z", change: "release" }
  source: skila-distill
---
body here
`;
    writeFileSync(join(dir, "SKILL.md"), legacy);

    const r = runMigrateSidecar();
    expect(r.migrated).toBeGreaterThanOrEqual(1);
    expect(r.errors).toEqual([]);

    const md = readFileSync(join(dir, "SKILL.md"), "utf8");
    expect(md).not.toMatch(/^skila:/m);
    // still parses and exposes name + description
    const parsed = parseSkillFile(md);
    expect(parsed.frontmatter.name).toBe("legacy-skill");
    expect(parsed.frontmatter.description).toContain("legacy");
    // sidecar has the moved values
    const sc = JSON.parse(readFileSync(join(dir, ".skila.json"), "utf8"));
    expect(sc.version).toBe("0.3.0");
    expect(sc.parentVersion).toBe("0.2.0");
    expect(sc.revisionCount).toBe(5);
    expect(sc.source).toBe("skila-distill");

    // Idempotent: second run skips.
    const r2 = runMigrateSidecar();
    expect(r2.migrated).toBe(0);
  });
});
