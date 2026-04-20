import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test FlatFileStorage in isolation by temporarily setting SKILA_HOME
describe("FIX-M5: flat.listVersions sorts by semver", () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "skila-test-"));
    origHome = process.env.SKILA_HOME;
    process.env.SKILA_HOME = tmpDir;
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.SKILA_HOME;
    else process.env.SKILA_HOME = origHome;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("back-dated v1.0.1 sorts after v1.0.0 even with earlier mtime", async () => {
    const { FlatFileStorage } = await import("../../src/storage/flat.js");
    const store = new FlatFileStorage();
    await store.init();

    // Write v1.0.0 first (newer mtime)
    await store.writeSkill("myskill", "1.0.0", "---\nname: myskill\nversion: 1.0.0\nstatus: draft\n---\nbody", {
      message: "initial",
      status: "draft"
    });

    // Simulate back-dated v1.0.1 by writing it and backdating meta
    await store.writeSkill("myskill", "1.0.1", "---\nname: myskill\nversion: 1.0.1\nstatus: draft\n---\nbody", {
      message: "patch",
      status: "draft"
    });

    // Manually overwrite meta for v1.0.0 to have a later date (so without semver sort it would appear first)
    const versionsDir = join(tmpDir, "versions", "myskill");
    const oldMeta = join(versionsDir, "v1.0.0", ".meta.json");
    writeFileSync(oldMeta, JSON.stringify({ version: "1.0.0", date: "2099-01-01T00:00:00.000Z", message: "initial", status: "draft" }));
    const newMeta = join(versionsDir, "v1.0.1", ".meta.json");
    writeFileSync(newMeta, JSON.stringify({ version: "1.0.1", date: "2000-01-01T00:00:00.000Z", message: "patch", status: "draft" }));

    const versions = await store.listVersions("myskill");
    expect(versions.length).toBe(2);
    // Sorted descending by semver: 1.0.1 first
    expect(versions[0].version).toBe("1.0.1");
    expect(versions[1].version).toBe("1.0.0");
  });

  it("sorts 1.10.0 after 1.9.0 (semver not lexicographic)", async () => {
    const { FlatFileStorage } = await import("../../src/storage/flat.js");
    const store = new FlatFileStorage();
    await store.init();

    await store.writeSkill("myskill2", "1.9.0", "---\nname: myskill2\nversion: 1.9.0\nstatus: draft\n---\nbody", {
      message: "v1.9",
      status: "draft"
    });
    await store.writeSkill("myskill2", "1.10.0", "---\nname: myskill2\nversion: 1.10.0\nstatus: draft\n---\nbody", {
      message: "v1.10",
      status: "draft"
    });

    const versions = await store.listVersions("myskill2");
    expect(versions[0].version).toBe("1.10.0");
    expect(versions[1].version).toBe("1.9.0");
  });
});

describe("FIX-M6: flat.diff emits valid unified diff with @@ hunks", () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "skila-diff-test-"));
    origHome = process.env.SKILA_HOME;
    process.env.SKILA_HOME = tmpDir;
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.SKILA_HOME;
    else process.env.SKILA_HOME = origHome;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("diff output contains @@ hunk header", async () => {
    const { FlatFileStorage } = await import("../../src/storage/flat.js");
    const store = new FlatFileStorage();
    await store.init();

    await store.writeSkill("diffskill", "1.0.0", "---\nname: diffskill\nversion: 1.0.0\nstatus: draft\n---\nold content\n", {
      message: "v1",
      status: "draft"
    });
    await store.writeSkill("diffskill", "1.0.1", "---\nname: diffskill\nversion: 1.0.1\nstatus: draft\n---\nnew content\n", {
      message: "v2",
      status: "draft"
    });

    const diffOutput = await store.diff("diffskill", "1.0.0", "1.0.1");
    expect(diffOutput).toContain("@@");
    expect(diffOutput).toMatch(/^---/m);
    expect(diffOutput).toMatch(/^\+\+\+/m);
  });
});
