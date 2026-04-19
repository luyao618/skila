// Shared test helper: per-test SKILA_HOME isolation under tmpdir.
import { mkdtempSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestEnv {
  home: string;
  skillsRoot: string;
  cleanup: () => void;
}

export function makeEnv(opts: { withFixtureSkill?: boolean } = {}): TestEnv {
  const base = mkdtempSync(join(tmpdir(), "skila-test-"));
  const home = join(base, "skila-data");
  const skillsRoot = join(base, "skills");
  mkdirSync(home, { recursive: true });
  mkdirSync(skillsRoot, { recursive: true });
  process.env.SKILA_HOME = home;
  process.env.SKILA_SKILLS_ROOT = skillsRoot;
  process.env.SKILA_FIXTURE_ROOT = join(process.cwd(), "tests", "fixtures", "judge-responses");
  if (opts.withFixtureSkill) {
    const src = join(process.cwd(), "tests", "fixtures", "skills", "azure-pipeline-debug");
    const dst = join(skillsRoot, "azure-pipeline-debug");
    cpSync(src, dst, { recursive: true });
  }
  return {
    home, skillsRoot,
    cleanup() {
      try { if (existsSync(base)) rmSync(base, { recursive: true, force: true }); } catch {}
      delete process.env.SKILA_HOME;
      delete process.env.SKILA_SKILLS_ROOT;
      delete process.env.SKILA_FIXTURE_ROOT;
    }
  };
}
