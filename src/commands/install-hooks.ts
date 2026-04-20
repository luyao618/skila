// src/commands/install-hooks.ts
// FIX-M22: `skila install-hooks` — merges PostToolUse + Stop hook entries into
// ~/.claude/settings.json, pointing to the globally-installed skila CLI.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

export interface InstallHooksResult {
  settingsPath: string;
  added: string[];
  skipped: string[];
  error?: string;
}

function resolveSkilaGlobalPath(): string {
  // Try to resolve where skila is installed globally
  try {
    const which = execSync("which skila", { encoding: "utf8" }).trim();
    if (which) return which;
  } catch { /* not on PATH */ }
  // Fallback: node modules global prefix
  try {
    const prefix = execSync("npm root -g", { encoding: "utf8" }).trim();
    const candidate = join(dirname(prefix), "bin", "skila");
    if (existsSync(candidate)) return candidate;
  } catch { /* ignore */ }
  return "skila"; // best-effort fallback
}

interface HookEntry {
  type: string;
  command: string;
}

interface ClaudeSettings {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

function claudeSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

export function runInstallHooks(): InstallHooksResult {
  const settingsPath = claudeSettingsPath();
  const skilaBin = resolveSkilaGlobalPath();

  // Hook definitions: PostToolUse and Stop
  const desiredHooks: Record<string, HookEntry[]> = {
    PostToolUse: [
      { type: "command", command: `${skilaBin} feedback --outcome=success` }
    ],
    Stop: [
      { type: "command", command: `${skilaBin} distill` }
    ],
  };

  // Load or initialize settings
  let settings: ClaudeSettings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8")) as ClaudeSettings;
    } catch {
      settings = {};
    }
  }
  if (!settings.hooks || typeof settings.hooks !== "object") {
    settings.hooks = {};
  }

  const added: string[] = [];
  const skipped: string[] = [];

  for (const [event, entries] of Object.entries(desiredHooks)) {
    if (!Array.isArray(settings.hooks![event])) {
      settings.hooks![event] = [];
    }
    for (const entry of entries) {
      const alreadyPresent = (settings.hooks![event] as HookEntry[]).some(
        (h) => h.type === entry.type && h.command === entry.command
      );
      if (alreadyPresent) {
        skipped.push(`${event}:${entry.command}`);
      } else {
        (settings.hooks![event] as HookEntry[]).push(entry);
        added.push(`${event}:${entry.command}`);
      }
    }
  }

  // Ensure ~/.claude directory exists
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

  process.stdout.write(`skila install-hooks: updated ${settingsPath}\n`);
  if (added.length > 0) process.stdout.write(`  added: ${added.join(", ")}\n`);
  if (skipped.length > 0) process.stdout.write(`  already present (skipped): ${skipped.join(", ")}\n`);

  return { settingsPath, added, skipped };
}
