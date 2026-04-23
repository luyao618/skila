// Supporting file extractor — heuristic rules to detect reusable artifacts from tool traces.

import { basename } from "node:path";
import type { ToolTraceEntry, SupportingFileCandidate, SupportingFileType } from "../types.js";

const ALLOWED_SUBDIRS: SupportingFileType[] = ["scripts", "references", "assets"];
const MAX_FILE_CHARS = 100_000;
const SLUG_RE = /[^a-z0-9._-]/g;

function slugify(name: string): string {
  return name.toLowerCase().replace(SLUG_RE, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "") || "file";
}

function hasTraversal(p: string): boolean {
  return p.includes("..") || p.startsWith("/");
}

/** Validate and normalize a supporting file candidate path. */
function validatePath(p: string): string | null {
  if (hasTraversal(p)) return null;
  const parts = p.split("/");
  if (parts.length < 2) return null;
  if (!ALLOWED_SUBDIRS.includes(parts[0] as SupportingFileType)) return null;
  return p;
}

/**
 * Extract supporting file candidates from a tool trace using heuristic rules.
 *
 * Rules (aligned with Claude Code skill-creator conventions):
 * - Repeated Bash commands (≥2 occurrences) → scripts/
 * - Long/complex Bash commands (>100 chars or pipes) → scripts/
 * - Read of .md/.txt docs → references/
 * - Read of .json/.yaml configs → references/
 * - Write of template-like files (.html/.tmpl) → assets/
 */
export function extractSupportingFiles(toolTrace: ToolTraceEntry[]): SupportingFileCandidate[] {
  const candidates: SupportingFileCandidate[] = [];
  const seen = new Set<string>();

  // --- Rule 1 & 2: Bash commands → scripts/ ---
  const bashCommands: Map<string, { count: number; fullCmd: string }> = new Map();

  for (const entry of toolTrace) {
    if (entry.tool !== "Bash") continue;
    const cmd = typeof entry.args?.command === "string" ? entry.args.command : "";
    if (!cmd.trim()) continue;

    // Normalize: collapse whitespace, trim
    const normalized = cmd.trim().replace(/\s+/g, " ");
    // Use first 80 chars as dedup key
    const key = normalized.slice(0, 200);
    const existing = bashCommands.get(key);
    if (existing) {
      existing.count++;
      // Keep the longest version
      if (normalized.length > existing.fullCmd.length) existing.fullCmd = normalized;
    } else {
      bashCommands.set(key, { count: 1, fullCmd: normalized });
    }
  }

  for (const [key, { count, fullCmd }] of bashCommands) {
    const isRepeated = count >= 2;
    const isComplex = fullCmd.length > 100 || fullCmd.includes("|");
    if (!isRepeated && !isComplex) continue;

    // Generate script name from first 2-3 meaningful words to reduce collisions
    const words = fullCmd.split(/\s+/).filter(w => !w.startsWith("-") && w.length > 1);
    const scriptName = slugify(words.slice(0, 3).join("-") || "script") + ".sh";
    const path = `scripts/${scriptName}`;

    if (seen.has(path)) continue;
    seen.add(path);

    const content = `#!/usr/bin/env bash\n# Auto-extracted from session tool trace\n${fullCmd}\n`;
    if (content.length > MAX_FILE_CHARS) continue;

    const confidence = isRepeated ? 0.8 : 0.6;
    const reason = isRepeated
      ? `Bash command repeated ${count} times`
      : `Complex Bash command (${fullCmd.length} chars${fullCmd.includes("|") ? ", contains pipe" : ""})`;

    candidates.push({
      path,
      content,
      fileType: "scripts",
      source: "tool-trace",
      confidence,
      reason,
    });
  }

  // --- Rule 3 & 4: Read operations → references/ ---
  const DOC_EXTS = new Set([".md", ".txt", ".rst"]);
  const CONFIG_EXTS = new Set([".json", ".yaml", ".yml", ".toml"]);

  for (const entry of toolTrace) {
    if (entry.tool !== "Read") continue;
    const filePath = typeof entry.args?.file_path === "string" ? entry.args.file_path : "";
    if (!filePath) continue;

    const ext = filePath.includes(".") ? "." + filePath.split(".").pop()!.toLowerCase() : "";
    if (!DOC_EXTS.has(ext) && !CONFIG_EXTS.has(ext)) continue;

    const name = basename(filePath);
    const path = `references/${slugify(name.replace(/\.[^.]+$/, ""))}${ext}`;

    if (seen.has(path)) continue;
    seen.add(path);

    // We don't have the actual content in the trace (result may be truncated),
    // so create a placeholder reference
    const content = entry.result
      ? (entry.result.length <= MAX_FILE_CHARS ? entry.result : entry.result.slice(0, MAX_FILE_CHARS))
      : `# ${name}\n\n<!-- Content from ${filePath} - replace with actual content -->\n`;

    candidates.push({
      path,
      content,
      fileType: "references",
      source: "tool-trace",
      confidence: DOC_EXTS.has(ext) ? 0.7 : 0.5,
      reason: `${DOC_EXTS.has(ext) ? "Document" : "Config"} read during session: ${filePath}`,
    });
  }

  // --- Rule 5: Write/Edit of template-like files → assets/ ---
  const TEMPLATE_EXTS = new Set([".html", ".tmpl", ".hbs", ".ejs", ".pug", ".svg"]);

  for (const entry of toolTrace) {
    if (entry.tool !== "Write" && entry.tool !== "Edit") continue;
    const filePath = typeof entry.args?.file_path === "string" ? entry.args.file_path : "";
    if (!filePath) continue;

    const ext = filePath.includes(".") ? "." + filePath.split(".").pop()!.toLowerCase() : "";
    if (!TEMPLATE_EXTS.has(ext)) continue;

    const name = basename(filePath);
    const path = `assets/${slugify(name.replace(/\.[^.]+$/, ""))}${ext}`;

    if (seen.has(path)) continue;
    seen.add(path);

    const content = typeof entry.args?.content === "string"
      ? entry.args.content.slice(0, MAX_FILE_CHARS)
      : `<!-- Template from ${filePath} -->\n`;

    candidates.push({
      path,
      content,
      fileType: "assets",
      source: "tool-trace",
      confidence: 0.6,
      reason: `Template file written during session: ${filePath}`,
    });
  }

  return candidates;
}
