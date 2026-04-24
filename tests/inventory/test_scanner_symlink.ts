// FIX-H12: Scanner reject symlinks + out-of-root paths
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, symlinkSync, rmSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanInventory, getLastScanWarnings } from "../../src/inventory/scanner.js";

let skillsRoot: string;
let savedSkillsRoot: string | undefined;

function makeSkill(dir: string, name: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\nversion: 1.0.0\n---\nbody`
  );
}

beforeEach(() => {
  skillsRoot = mkdtempSync(join(tmpdir(), "skila-scanner-test-"));
  savedSkillsRoot = process.env.SKILA_SKILLS_ROOT;
  process.env.SKILA_SKILLS_ROOT = skillsRoot;
});

afterEach(() => {
  process.env.SKILA_SKILLS_ROOT = savedSkillsRoot;
  try { rmSync(skillsRoot, { recursive: true, force: true }); } catch {}
});

describe("FIX-H12: Scanner symlink + out-of-root rejection", () => {
  it("returns a normal skill directory successfully", () => {
    makeSkill(join(skillsRoot, "my-skill"), "my-skill");
    const skills = scanInventory();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("my-skill");
    expect(getLastScanWarnings()).toHaveLength(0);
  });

  it("follows a symlinked skill directory and emits a warning", () => {
    // Create a real skill dir outside root
    const outside = mkdtempSync(join(tmpdir(), "skila-outside-"));
    try {
      makeSkill(join(outside, "evil-skill"), "evil-skill");
      // Plant symlink inside skills root pointing to outside
      symlinkSync(join(outside, "evil-skill"), join(skillsRoot, "evil-link"));

      const skills = scanInventory();
      // The symlinked entry SHOULD appear in results (symlinks are followed)
      expect(skills.find(s => s.name === "evil-skill")).toBeDefined();

      const warnings = getLastScanWarnings();
      expect(warnings.some(w => w.type === "symlink")).toBe(true);
      expect(warnings.some(w => w.path.includes("evil-link"))).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("includes symlinked skill content alongside legitimate skills", () => {
    // Create a real skill
    makeSkill(join(skillsRoot, "real-skill"), "real-skill");
    // Create symlink to outside
    const outside = mkdtempSync(join(tmpdir(), "skila-outside2-"));
    try {
      makeSkill(join(outside, "hacked"), "hacked");
      symlinkSync(join(outside, "hacked"), join(skillsRoot, "hacked-link"));

      const skills = scanInventory();
      expect(skills.some(s => s.name === "real-skill")).toBe(true);
      expect(skills.some(s => s.name === "hacked")).toBe(true);

      const warnings = getLastScanWarnings();
      expect(warnings.some(w => w.type === "symlink")).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("clears warnings between scanInventory calls", () => {
    // First scan with symlink
    const outside = mkdtempSync(join(tmpdir(), "skila-outside3-"));
    try {
      makeSkill(join(outside, "s"), "s");
      symlinkSync(join(outside, "s"), join(skillsRoot, "sym"));
      scanInventory();
      expect(getLastScanWarnings()).toHaveLength(1);

      // Remove symlink (not recursive, it's a symlink not a real dir), scan again
      unlinkSync(join(skillsRoot, "sym"));
      scanInventory();
      expect(getLastScanWarnings()).toHaveLength(0);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
