# Deep Interview Spec: skila — Self-Improving Skill Inventory Controller

## Metadata
- Interview ID: skila-distill-2026-04-18
- Rounds: 8
- Final Ambiguity Score: 14%
- Type: greenfield
- Generated: 2026-04-18
- Threshold: 20%
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.95 | 0.40 | 0.38 |
| Constraint Clarity | 0.75 | 0.30 | 0.225 |
| Success Criteria | 0.85 | 0.30 | 0.255 |
| **Total Clarity** | | | **0.86** |
| **Ambiguity** | | | **0.14** |

## Goal

Build **skila**, a Claude Code plugin that, when invoked mid- or end-of-session via the `/skila` slash command, distills the agent's in-context conversation memory into zero, one, or several **production-ready, executable Anthropic-spec skill packages** — not just SKILL.md docs. Each proposal is presented to the user as either a **new skill creation** or an **update to an existing skill** (detected by an LLM judging against the current skill inventory). The user accepts or discards each proposal through interactive `AskUserQuestion` prompts. Accepted proposals are written as **complete skill directories** following the official Anthropic skill format (https://github.com/anthropics/skills/tree/main/skills/skill-creator) — including `SKILL.md` + `scripts/` (executable code where applicable) + `references/` (domain docs) + `assets/` (templates) — to either the global (`~/.claude/skills/`) or project-local (`.claude/skills/`) directory.

In one sentence: **a user-triggered, agent-memory-based, LLM-judged skill induction plugin for Claude Code that produces real, runnable, Anthropic-spec-compliant skill packages — not documentation stubs.**

## Quality Bar (CRITICAL — non-negotiable)

skila MUST NOT produce "garbage skills" — i.e., SKILL.md files with only prose and no supporting executable assets when the workflow they describe needs them. Concretely:

- **Skills that describe deterministic procedures** (e.g., "fetch logs and grep for X") MUST include a `scripts/` directory with a runnable script (Python/Bash/TS) implementing the procedure, not just a prose description telling the agent to do it.
- **Skills that depend on domain knowledge** (e.g., error code tables, API quirks, format specs) MUST include a `references/` directory with that knowledge as standalone documents the skill body can point to.
- **Skills that emit standardized output** (reports, configs, templates) MUST include an `assets/` directory with the templates.
- The `SKILL.md` itself follows the [official skill-creator schema](https://github.com/anthropics/skills/tree/main/skills/skill-creator):
  - Required frontmatter: `name`, `description` (description should be "pushy" about triggering — explicit keyword/context cues, not passive)
  - Optional frontmatter: `compatibility` (tools/dependencies)
  - Body: imperative instructions with the *why*, hierarchical structure, references to bundled scripts/assets, target ≤500 lines
- **Reference model**: hermes-agent's skill manager is the design north star for "what a real, induced skill looks like". Skila must produce skills of comparable quality.

## Constraints

- **Trigger**: user-initiated only via `/skila` slash command — no automatic Stop hook.
- **Source of truth**: the live agent's in-context memory of the current session. **Do NOT** read JSONL transcripts from `~/.claude/projects/`.
- **Skill destination**: chosen per-proposal by the user — either `~/.claude/skills/<name>/SKILL.md` (global) or `<repo>/.claude/skills/<name>/SKILL.md` (project-local).
- **Skill format**: standard Claude Code `SKILL.md` with YAML frontmatter (`name`, `description`, optional `argument-hint`) + markdown body, matching the format already used by skills loaded in this very session (see system reminder skill list for examples).
- **Similarity detection**: pure LLM judgment — at proposal time, skila scans both global and project-local skill directories, builds a list of `name + description` pairs, and feeds the entire list to the proposal agent so it can flag relations on its own. **No embeddings, no tags, no vector index.**
- **Quality criteria for proposing a skill** (any one suffices):
  1. Complex/non-trivial task that succeeded (multi-step, multi-tool, errors overcome — Hermes-style).
  2. Reusable workflow likely to recur in future sessions (even if simple).
  3. User correction or stated preference that should be persisted as future default behavior.
- **Empty result is a first-class outcome**: if nothing meets the criteria, skila must explicitly tell the user "no skill worth crystallizing" rather than fabricating one.
- **Plugin shape**: model after memex — `.claude-plugin/plugin.json` manifest, `skills/skila/SKILL.md` as the entry, optional supporting skills/agents. No required MCP server in v1.

## Process Constraints (Research-First Development)

- **R-DOC-1 (must precede any implementation)**: Produce `docs/research/hermes-and-memex-study.md` with deep analysis of:
  - **Hermes-agent**: skill self-induction mechanism — trigger heuristics, SKILL.md schema/validation, create vs update vs patch semantics, security scanning, naming rules. Key file: `tools/skill_manager_tool.py` at `/Users/yao/work/code/awesome-project/hermes-agent`.
  - **Memex**: session-to-card distillation — `Stop` hook + `memex-retro` skill flow, Fact Hygiene Check, dedup strategy, wiki-link/association mechanism, card storage layout. Key paths: `skills/memex-retro/SKILL.md`, `src/commands/write.ts`, `src/lib/store.ts` at `/Users/yao/work/code/awesome-project/memex`.
- **R-DOC-2**: The research doc must explicitly state, for each insight, **what skila borrows / what skila deliberately diverges from / why** — serving as the project's anti-drift anchor.
- **R-DOC-3**: Every implementation PR/commit must cite the relevant section of the research doc as its rationale. Deviations require a "Decision Update" section appended to the doc explaining the reason.

## Non-Goals

- Reading historical session transcript files.
- Automatic Stop-hook triggering in v1.
- Embedding-based or tag-based similarity (deferred to a possible v2).
- Cross-machine sync of generated skills.
- Hermes-style runtime skill execution engine — skila only **produces** SKILL.md files; CC's native skill loader runs them.
- Editing skills outside `~/.claude/skills/` and `<repo>/.claude/skills/` (e.g., plugin-installed skills under `~/.claude/plugins/cache/...` are read-only references for similarity but never written).

## Acceptance Criteria

- [ ] **R-DOC-1 satisfied**: `docs/research/hermes-and-memex-study.md` exists, covers both projects per the structure described above, and is committed BEFORE any code in `skills/`, `src/`, or `.claude-plugin/` lands.
- [ ] Research doc explicitly enumerates skila's borrowings and divergences from each reference project.
- [ ] **Skill packages produced by skila are production-ready, not docs-only**:
  - Each generated skill is a directory, not a single file.
  - `SKILL.md` follows the official Anthropic skill-creator schema (frontmatter `name`+`description` required, `compatibility` optional; description is "pushy" with explicit triggering cues).
  - When the workflow involves deterministic procedures, skila MUST emit a `scripts/` directory with at least one runnable script (Python/Bash/TS) that the SKILL.md body references by path.
  - When the workflow depends on domain knowledge (error tables, API specs, format references), skila MUST emit a `references/` directory with that knowledge as standalone files.
  - When the workflow emits standardized output (reports, configs), skila MUST emit an `assets/` directory with templates.
  - SKILL.md body ≤500 lines, hierarchical, imperative, with the *why* — not just *what*.
- [ ] A "skill quality lint" pass runs after generation: rejects any proposal whose SKILL.md is pure prose when its description implies executable behavior. Lint failures are surfaced to the user as warnings before write.
- [ ] Running `/skila` in a CC session triggers a single proposal pass over the agent's current context.
- [ ] If the session has no skill-worthy content, skila prints a clear "no proposals" message and exits cleanly.
- [ ] If the session has skill-worthy content, skila scans `~/.claude/skills/` and `<cwd>/.claude/skills/` to build an inventory of existing skills (name + description).
- [ ] An LLM proposal pass produces N candidates (N ≥ 0), each tagged either `[NEW]` or `[UPDATE → <existing-skill-name>]`.
- [ ] Candidates are presented in a **single multi-select `AskUserQuestion`**, one line per candidate in the format:
  `[NEW|UPDATE → X] <name> — <description> (~<lines> lines, <complexity>)`
- [ ] After multi-select, for each accepted `[UPDATE]` candidate, skila shows a **per-candidate `AskUserQuestion`** with three options: `[Apply patch]` / `[Skip]` / `[Show full new version]`, including the diff against the existing SKILL.md.
- [ ] For each accepted `[NEW]` candidate, skila asks the user to choose **scope** (global vs project-local) and writes a fresh `<scope>/skills/<name>/SKILL.md`.
- [ ] All writes use atomic write semantics (temp file + rename) to avoid corrupting existing SKILL.md files on failure.
- [ ] At end of run, skila prints a summary: `N created, M updated, K skipped, L discarded`.
- [ ] Generated SKILL.md files validate against the standard CC format (YAML frontmatter parses, `name` matches directory, `description` ≤ 1024 chars).

## Assumptions Exposed & Resolved

| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| skila must auto-trigger like memex | Round 1 forced choice between hook / slash / transcript-read | User-initiated `/skila` only |
| skill output should be one location | Round 2 forced choice | Per-proposal user choice between global and project-local |
| Always produce ≥1 skill per run | Round 3 user note: "如果没有 可以跟用户说 没有值得固化skill" | Empty result is a valid, explicit outcome |
| Need embeddings for similarity (Contrarian challenge) | Round 4 contrarian probe | Pure LLM judgment over name+description list — no index, no embeddings |
| Single quality judgement criterion | Round 5 multi-option | Disjunction of three Hermes-style criteria; any one suffices |
| Need rich custom UI | Round 6 simplifier challenge | Native CC `AskUserQuestion` multi-select is sufficient |
| Updates should be silent | Round 8 forced choice | Each update gets its own per-candidate `AskUserQuestion` with diff |

## Technical Context (greenfield)

- **Language/runtime**: TypeScript or pure-skill (no compiled code) — TBD in ralplan stage. Memex uses TypeScript+npm; for v1 a pure-skill (markdown-only) design may suffice since the agent does the work.
- **Plugin manifest**: `.claude-plugin/plugin.json` minimal manifest (name, description, version, license).
- **Layout** (proposed):
  ```
  skila/
  ├── .claude-plugin/
  │   └── plugin.json
  ├── skills/
  │   └── skila/
  │       └── SKILL.md          # the /skila entry skill
  ├── README.md
  └── LICENSE
  ```
- **Reference projects**:
  - Memex: `/Users/yao/work/code/awesome-project/memex` — plugin manifest + skills + hooks pattern.
  - Hermes: `/Users/yao/work/code/awesome-project/hermes-agent` — `tools/skill_manager_tool.py` for create/update/patch semantics and SKILL.md validation rules.

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Session | external | turns, agent context | source for SkillProposal |
| User | actor | choices | accepts/discards SkillProposal |
| Skill | core domain | name, description, body, scope | written to filesystem |
| ExistingSkill | core domain | name, description, path, scope | matched by SkillProposal for update |
| SkillProposal | core domain | name, description, body, mode (new/update), target, lines, complexity | the unit of decision |
| UpdatePatch | supporting | target ExistingSkill, diff, full new version | child of SkillProposal when mode=update |
| SkillScope | supporting | enum: global / project-local | attribute of Skill on creation |
| SkillIndex | supporting | list of (name, description, scope, path) | scanned input to proposal LLM |

## Ontology Convergence

| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 4 | 4 | 0 | 0 | N/A |
| 2 | 5 | 1 | 0 | 4 | 80% |
| 3 | 7 | 2 | 0 | 5 | 71% |
| 4 | 8 | 1 | 0 | 7 | 87.5% |
| 5 | 8 | 0 | 0 | 8 | 100% |
| 6 | 8 | 0 | 0 | 8 | 100% |
| 7 | 8 | 0 | 0 | 8 | 100% |
| 8 | 8 | 0 | 0 | 8 | 100% |

Ontology converged from round 5 onward — domain model is stable.

## Interview Transcript

<details>
<summary>Full Q&A (8 rounds)</summary>

### Round 1 — Trigger model
**Q:** When and how does the user invoke skila?
**A:** 2 — Slash command, same session (in-context memory)
**Ambiguity:** 77.5%

### Round 2 — Skill destination
**Q:** Where should generated skills be written?
**A:** 4 — User chooses per-proposal (global vs project-local)
**Ambiguity:** 66.5%

### Round 3 — Output shape
**Q:** What does one `/skila` invocation produce?
**A:** Custom — Adaptive: 0/1/N depending on session content; explicit "no skills worth crystallizing" message when empty; for related skills offer update with specifics.
**Ambiguity:** 43.5%

### Round 4 — Similarity detection (Contrarian)
**Q:** How does skila find related existing skills?
**A:** 1 — Pure LLM judgment over the name+description list
**Ambiguity:** 34%

### Round 5 — Quality criteria
**Q:** What counts as "worth crystallizing"?
**A:** Custom — Any of (1) complex/non-trivial success, (2) reusable workflow, (3) user correction/preference
**Ambiguity:** 25.9%

### Round 6 — Presentation UI (Simplifier)
**Q:** How are candidates shown to the user?
**A:** 2 — Single multi-select `AskUserQuestion` listing all candidates
**Ambiguity:** 19%

### Round 7 — Per-row format
**Q:** What does each candidate row look like in the multi-select?
**A:** 3 — `[NEW|UPDATE → X] name — description (~lines, complexity)`
**Ambiguity:** ~16%

### Round 8 — Update interaction
**Q:** How are accepted UPDATE candidates confirmed?
**A:** 2 — Per-candidate `AskUserQuestion` with [Apply patch] / [Skip] / [Show full new version]
**Ambiguity:** 14%

</details>
