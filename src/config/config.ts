// skila runtime config + paths. Honours SKILA_HOME env var for test isolation
// and Smithery (D5) ephemeral mode.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SkilaConfig {
  port: number;
  promotionFloorInvocations: number;
  promotionFloorFailures: number;
  judgeTokenBudget: number;
  lockTimeoutMs: number;
  lockStaleMs: number;
  disabledHooks: string[];
  translateTargetLang?: string;
  translateBaseUrl?: string;
  translateModel?: string;
}

export const DEFAULT_CONFIG: SkilaConfig = {
  port: 7777,
  promotionFloorInvocations: 10,
  promotionFloorFailures: 1,
  judgeTokenBudget: 4000,
  lockTimeoutMs: 500,
  lockStaleMs: 5000,
  disabledHooks: []
};

export function skilaHome(): string {
  // SKILA_HOME overrides ~/.claude/skila-data/ for tests + Smithery (D5).
  const env = process.env.SKILA_HOME;
  if (env && env.length > 0) return env;
  return join(homedir(), ".claude", "skila-data");
}

export function skillsRoot(): string {
  // SKILA_SKILLS_ROOT overrides ~/.claude/skills/ for tests.
  const env = process.env.SKILA_SKILLS_ROOT;
  if (env && env.length > 0) return env;
  return join(homedir(), ".claude", "skills");
}

export function statusDir(status: import("../types.js").SkillStatus): string {
  const root = skillsRoot();
  switch (status) {
    case "published":
      return root;
    case "draft":
      return join(root, ".draft-skila");
    case "staging":
      return join(root, ".staging-skila");
    case "archived":
      return join(root, ".archived-skila");
    case "disabled":
      return join(root, ".disabled-skila");
  }
}

export function ensureSkilaHome(): string {
  const home = skilaHome();
  mkdirSync(home, { recursive: true });
  mkdirSync(join(home, "judge-cache"), { recursive: true });
  mkdirSync(join(home, "logs"), { recursive: true });
  return home;
}

export function configPath(): string {
  return join(ensureSkilaHome(), "config.json");
}

export function loadConfig(): SkilaConfig {
  const p = configPath();
  if (!existsSync(p)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: Partial<SkilaConfig>): SkilaConfig {
  const merged = { ...loadConfig(), ...cfg };
  writeFileSync(configPath(), JSON.stringify(merged, null, 2));
  return merged;
}
