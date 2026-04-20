// Judge token-budget manager (Scenario D mitigation).
// - 4K input cap
// - inventory-hash cache (~/.claude/skila-data/judge-cache/, 7d TTL)
// - degraded path: name-only inventory when full prompt > budget

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ensureSkilaHome, loadConfig } from "../config/config.js";
import type { Skill } from "../types.js";

export type PromptMode = "full" | "degraded" | "cached";

export interface BudgetInputs {
  inventory: Skill[];
  candidateBody: string;
  toolTraceText: string;
  instructions: string;
}

// Cheap token estimator: ~4 chars per token (English-leaning).
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export function inventoryHash(inventory: Skill[]): string {
  const parts = inventory
    .map((s) => `${s.name}|${s.frontmatter.skila?.version ?? "?"}|${s.frontmatter.skila?.lastImprovedAt ?? ""}`)
    .sort();
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

function cacheDir(): string {
  return join(ensureSkilaHome(), "judge-cache");
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function readInventoryCache(hash: string): string | null {
  const f = join(cacheDir(), `inventory-${hash}.json`);
  if (!existsSync(f)) return null;
  const st = statSync(f);
  if (Date.now() - st.mtimeMs > TTL_MS) {
    try { unlinkSync(f); } catch {}
    return null;
  }
  try {
    return JSON.parse(readFileSync(f, "utf8")).summary as string;
  } catch {
    return null;
  }
}

export function writeInventoryCache(hash: string, summary: string): void {
  const f = join(cacheDir(), `inventory-${hash}.json`);
  writeFileSync(f, JSON.stringify({ ts: Date.now(), summary }));
}

export function pruneStaleCache(): number {
  const dir = cacheDir();
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    try {
      const st = statSync(full);
      if (Date.now() - st.mtimeMs > TTL_MS) {
        unlinkSync(full);
        removed++;
      }
    } catch { /* race */ }
  }
  return removed;
}

export function inventorySummary(inv: Skill[], full: boolean): string {
  if (full) {
    return inv
      .map((s) => `- ${s.name} (v${s.frontmatter.skila?.version ?? "?"}, ${s.status}): ${s.frontmatter.description ?? ""}\n  ${s.body.slice(0, 200).replace(/\n/g, " ")}`)
      .join("\n");
  }
  // degraded: names + descriptions only
  return inv.map((s) => `- ${s.name}: ${s.frontmatter.description ?? ""}`).join("\n");
}

export interface BuiltPrompt {
  prompt: string;
  mode: PromptMode;
  tokens: number;
}

export function buildBudgetedPrompt(inputs: BudgetInputs): BuiltPrompt {
  const cfg = loadConfig();
  const budget = cfg.judgeTokenBudget;
  const hash = inventoryHash(inputs.inventory);

  // Try full mode
  const fullInv = inventorySummary(inputs.inventory, true);
  let prompt = `${inputs.instructions}\n\n## Inventory\n${fullInv}\n\n## Candidate\n${inputs.candidateBody}\n\n## Tool sequence (last 30)\n${inputs.toolTraceText}\n`;
  let tokens = estimateTokens(prompt);
  if (tokens <= budget) {
    const alreadyCached = readInventoryCache(hash);
    writeInventoryCache(hash, fullInv);
    return { prompt, mode: alreadyCached ? "cached" : "full", tokens };
  }

  // Truncate inventory first (drop oldest-touched)
  const sortedInv = [...inputs.inventory].sort((a, b) => {
    const at = a.frontmatter.skila?.lastImprovedAt ?? "";
    const bt = b.frontmatter.skila?.lastImprovedAt ?? "";
    return at.localeCompare(bt);
  });
  let kept = sortedInv;
  while (kept.length > 0 && tokens > budget) {
    kept = kept.slice(1);
    const inv = inventorySummary(kept, true);
    prompt = `${inputs.instructions}\n\n## Inventory\n${inv}\n\n## Candidate\n${inputs.candidateBody}\n\n## Tool sequence (last 30)\n${inputs.toolTraceText}\n`;
    tokens = estimateTokens(prompt);
  }
  if (tokens <= budget) return { prompt, mode: "full", tokens };

  // Degrade to name-only
  let degradedKept = inputs.inventory;
  let degradedInv = inventorySummary(degradedKept, false);
  // Truncate tool trace tail
  let trace = inputs.toolTraceText;
  // Truncate candidate body
  let body = inputs.candidateBody;
  const recompute = () => {
    prompt = `${inputs.instructions}\n\n## Inventory (name-only, degraded)\n${degradedInv}\n\n## Candidate\n${body}\n\n## Tool sequence (truncated)\n${trace}\n`;
    tokens = estimateTokens(prompt);
  };
  recompute();
  while (trace.length > 200 && tokens > budget) {
    trace = trace.slice(Math.floor(trace.length / 2));
    recompute();
  }
  while (body.length > 200 && tokens > budget) {
    body = body.slice(0, Math.floor(body.length / 2));
    recompute();
  }
  // Last resort: drop inventory entries from the front (oldest first)
  const sortedDeg = [...inputs.inventory].sort((a, b) => {
    const at = a.frontmatter.skila?.lastImprovedAt ?? "";
    const bt = b.frontmatter.skila?.lastImprovedAt ?? "";
    return at.localeCompare(bt);
  });
  while (sortedDeg.length > 0 && tokens > budget) {
    sortedDeg.shift();
    degradedInv = inventorySummary(sortedDeg, false);
    recompute();
  }
  return { prompt, mode: "degraded", tokens };
}
