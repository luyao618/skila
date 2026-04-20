// distill orchestrator: extractor → judge → validate → write to .draft-skila/.
// Hallucination guard: judge UPDATE→X but X not in inventory → downgrade to NEW
// + structured warning.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { extractCandidateFromFixture } from "../distill/extractor.js";
import { scanInventory, findSkill } from "../inventory/scanner.js";
import { callJudge } from "../judge/judge.js";
import { statusDir } from "../config/config.js";
import { validateSkillContent } from "../validate/validate.js";
import { writeSkillFile, bumpVersion, appendChangelog } from "./_lifecycle.js";
export async function runDistill(opts) {
    if (!opts.fromFixture)
        throw new Error("distill: --from-fixture required in Phase 2");
    const candidate = extractCandidateFromFixture(opts.fromFixture);
    const inventory = scanInventory();
    const { output } = await callJudge({ candidate, inventory });
    const warnings = [];
    let mode = output.decision;
    let target = output.target_name ?? undefined;
    // Hallucination guard
    if (mode === "UPDATE" && target && !findSkill(target)) {
        warnings.push({ type: "judge_hallucination", proposed: target, detail: `judge proposed UPDATE→${target} but ${target} not found` });
        // log
        process.stderr.write(`skila distill: judge proposed UPDATE→${target} but ${target} not found\n`);
        mode = "NEW";
        target = undefined;
    }
    let proposal;
    if (mode === "UPDATE" && target) {
        const existing = findSkill(target);
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
            changelogEntry: `Revised from session ${candidate.sessionId ?? "(unknown)"}: ${output.justification}`,
            warnings
        };
    }
    else {
        proposal = {
            name: candidate.name,
            mode: "NEW",
            newVersion: "0.1.0",
            body: candidate.body,
            description: candidate.description,
            changelogEntry: `Initial draft from session ${candidate.sessionId ?? "(unknown)"}`,
            warnings
        };
    }
    if (opts.dryRun) {
        return { proposal, judgeOutput: output, warnings };
    }
    // Build clean frontmatter (no skila block) + sidecar metadata.
    const fm = {
        name: proposal.name,
        description: proposal.description,
        compatibility: { node: ">=20" },
    };
    const sidecar = {
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
    return { proposal, judgeOutput: output, warnings, draftPath: file };
}
//# sourceMappingURL=distill.js.map