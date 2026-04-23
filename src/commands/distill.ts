// distill orchestrator: extractor → judge → validate → write to .draft-skila/.
// Hallucination guard: judge UPDATE→X but X not in inventory → downgrade to NEW
// + structured warning.

import { join, dirname } from "node:path";
import { readFileSync, mkdirSync } from "node:fs";
import type { DistillCandidate, SkillProposal, WarningRecord, JudgeOutput, SkillFrontmatter, SkilaMetadata } from "../types.js";
import { extractCandidateFromFixture } from "../distill/extractor.js";
import { extractSupportingFiles } from "../distill/file-extractor.js";
import { scanInventory, findSkill } from "../inventory/scanner.js";
import { callJudge } from "../judge/judge.js";
import { sanitizeJustification } from "../judge/prompt.js";
import { statusDir } from "../config/config.js";
import { validateSkillContent } from "../validate/validate.js";
import { writeSkillFile, bumpVersion, appendChangelog } from "./_lifecycle.js";
import { atomicWriteFileSync } from "../storage/atomic.js";

export interface DistillOptions {
  fromFixture?: string;
  dryRun?: boolean;
}

export interface DistillResult {
  proposal: SkillProposal;
  judgeOutput: JudgeOutput;
  warnings: WarningRecord[];
  draftPath?: string;
}

export async function runDistill(opts: DistillOptions): Promise<DistillResult> {
  if (!opts.fromFixture) throw new Error("distill: --from-fixture required in Phase 2");
  const candidate = extractCandidateFromFixture(opts.fromFixture);
  const inventory = scanInventory();

  // Phase A: Rule-based extraction of supporting file candidates
  const fileCandidates = extractSupportingFiles(candidate.toolTrace);
  candidate.supportingFiles = fileCandidates;

  const { output } = await callJudge({ candidate, inventory, supportingFileCandidates: fileCandidates });
  const warnings: WarningRecord[] = [];

  let mode: "NEW" | "UPDATE" = output.decision;
  let target = output.target_name ?? undefined;

  // Hallucination guard: UPDATE with empty/blank target_name — reject, do not coerce
  if (mode === "UPDATE" && !target?.trim()) {
    warnings.push({ type: "judge_hallucination", proposed: target ?? "", detail: "update_without_target: judge proposed UPDATE but target_name is empty" });
    process.stderr.write(`skila distill: judge proposed UPDATE but target_name is empty — rejected\n`);
    return { proposal: { name: candidate.name, mode: "NEW", newVersion: "0.1.0", body: candidate.body, description: candidate.description, changelogEntry: `Initial draft from session ${candidate.sessionId ?? "(unknown)"}`, warnings }, judgeOutput: output, warnings };
  }

  // Hallucination guard: UPDATE target not in inventory
  if (mode === "UPDATE" && target && !findSkill(target)) {
    warnings.push({ type: "judge_hallucination", proposed: target, detail: `judge proposed UPDATE→${target} but ${target} not found` });
    // log
    process.stderr.write(`skila distill: judge proposed UPDATE→${target} but ${target} not found\n`);
    mode = "NEW";
    target = undefined;
  }

  let proposal: SkillProposal;

  // Collect confirmed supporting files from judge (with path validation)
  const VALID_FILE_TYPES = new Set(["scripts", "references", "assets"]);
  const confirmedFiles = (output.supporting_files ?? [])
    .filter(f => f.action !== "remove")
    .filter(f => {
      const parts = f.path.split("/");
      if (parts.length < 2 || !VALID_FILE_TYPES.has(parts[0])) return false;
      if (f.path.includes("..") || f.path.startsWith("/")) return false;
      return true;
    })
    .map(f => ({ path: f.path, content: f.content, fileType: f.path.split("/")[0] as "scripts" | "references" | "assets" }));

  // Fallback: if judge didn't return supporting_files (heuristic mode), use rule-extracted candidates with confidence >= 0.6
  const finalFiles = confirmedFiles.length > 0
    ? confirmedFiles
    : fileCandidates
        .filter(f => f.confidence >= 0.6)
        .map(f => ({ path: f.path, content: f.content, fileType: f.fileType }));

  if (mode === "UPDATE" && target) {
    const existing = findSkill(target)!;
    const parentVersion = existing.skila.version || "0.0.0";
    const newVersion = bumpVersion(parentVersion, output.suggested_version_bump ?? "minor");
    proposal = {
      name: target,
      mode: "UPDATE",
      targetName: target,
      parentVersion,
      newVersion,
      body: candidate.body,
      description: candidate.description,
      changelogEntry: `Revised from session ${candidate.sessionId ?? "(unknown)"}: ${sanitizeJustification(output.justification)}`,
      warnings,
      supportingFiles: finalFiles.length > 0 ? finalFiles : undefined,
    };
  } else {
    proposal = {
      name: candidate.name,
      mode: "NEW",
      newVersion: "0.1.0",
      body: candidate.body,
      description: candidate.description,
      changelogEntry: `Initial draft from session ${candidate.sessionId ?? "(unknown)"}`,
      warnings,
      supportingFiles: finalFiles.length > 0 ? finalFiles : undefined,
    };
  }

  if (opts.dryRun) {
    return { proposal, judgeOutput: output, warnings };
  }

  // Append bundled resource references to SKILL.md body
  if (finalFiles.length > 0) {
    const refs = output.skill_body_references ?? finalFiles.map(f =>
      `- **${f.path}**: ${f.fileType === "scripts" ? "Execute" : f.fileType === "references" ? "Load" : "Use"} as needed`
    );
    proposal.body = (proposal.body || "") + "\n\n## Bundled Resources\n\n" + refs.join("\n") + "\n";
  }

  // Build clean frontmatter (no skila block) + sidecar metadata.
  const fm: SkillFrontmatter = {
    name: proposal.name,
    description: proposal.description,
    compatibility: { node: ">=20" },
  };
  const sidecar: SkilaMetadata = {
    version: proposal.newVersion,
    status: "draft",
    parentVersion: proposal.parentVersion ?? null,
    revisionCount: proposal.mode === "UPDATE" ? 1 : 0,
    lastImprovedAt: new Date().toISOString(),
    changelog: [],
    source: proposal.mode === "UPDATE" ? "skila-revise" : "skila-distill"
  };
  appendChangelog(sidecar, proposal.newVersion, proposal.changelogEntry);

  const draftDir = join(statusDir("draft"), proposal.name);
  const file = await writeSkillFile(draftDir, fm, proposal.body || `# ${proposal.name}\n\n${proposal.description}\n`, sidecar);
  // Validate after write (SKILL.md only — sidecar is schema-validated elsewhere).
  validateSkillContent(readFileSync(file, "utf8"), { expectedDirName: proposal.name });

  // Write supporting files
  if (proposal.supportingFiles?.length) {
    for (const sf of proposal.supportingFiles) {
      const filePath = join(draftDir, sf.path);
      mkdirSync(dirname(filePath), { recursive: true });
      atomicWriteFileSync(filePath, sf.content);
    }
  }

  return { proposal, judgeOutput: output, warnings, draftPath: file };
}
