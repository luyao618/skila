---
name: skila
description: "Distill in-context Claude Code session memory into production-ready Anthropic-spec skill packages. Invoke /skila whenever the user types /skila or asks to distill the current session into reusable skills. Presents a multi-select of [NEW@global], [NEW@local], and [UPDATE→<existing>] proposals, runs validate + lint gates, and writes complete skill packages (SKILL.md + scripts/ + references/ + assets/ as needed) to ~/.claude/skills/ or <repo>/.claude/skills/. Also use when: user says 'capture this workflow', 'save this as a skill', or 'add this to my skill library'."
compatibility: { node: ">=20" }
skila:
  version: "0.1.0"
  status: "published"
  parentVersion: null
  revisionCount: 0
  lastImprovedAt: "2026-04-19T00:00:00Z"
  changelog:
    - { version: "0.1.0", date: "2026-04-19", change: "Initial v0.1.0 skill package (Phase 6 dogfood)" }
  source: "user-edit-via-web"
---

## Overview

**skila** is a TypeScript Claude Code plugin that continuously evolves a
personal skill library from live session memory. It inverts every learner
gap identified in v1: no Python, no fire-and-forget distillation, no silent
overwrites, and no opaque quality gates.

---

## When `/skila` Fires

The `/skila` slash command is the **primary trigger**. Execute this procedure
only when:

1. The user explicitly invokes `/skila`, OR
2. The user says "capture this workflow", "save this as a skill", or
   "add this to my skill library".

If loaded by any other means, do nothing and return immediately.

---

## Distill Workflow

### Step 1 — Read the Proposal Criteria

Read `references/proposal-criteria.md`. Apply the three criteria as a
disjunction (any one criterion suffices for promotion):

- **Criterion 1**: Multi-step, multi-tool workflow that succeeded.
- **Criterion 2**: Reusable workflow likely to recur across sessions.
- **Criterion 3**: User correction or stated preference that should persist.

Extract candidates from the agent's **current in-context conversation memory
only** — do NOT read `~/.claude/projects/` or any JSONL transcript files.

### Step 2 — Inventory Scan

Run the inventory scanner to discover installed skills:

```
node skills/skila/scripts/scan.mjs
```

Capture the JSON list of `{name, description, scope, path}` objects.
If the script exits non-zero, surface stderr and abort.

### Step 3 — LLM Judge Pass

For each distilled candidate, classify as `[NEW]` or `[UPDATE→<name>]`
using the current inventory (Step 2) and the last 30 tool-trace entries
from the session. Emit `[UPDATE→X]` only when X exactly matches a `name`
in the inventory. Apply the Wave-1 soft cap of 8 rows; collapse excess into
`[+N more low-confidence candidates omitted]`.

Row format (see `assets/proposal-row.tmpl` for exact template):
```
[NEW@global]     <proposed-name>     <one-line reason>
[NEW@local]      <proposed-name>     <one-line reason>
[UPDATE→X]       X                   <one-line reason>
[UPDATE→X@staging]  X               <one-line reason> (in staging)
```

### Step 4 — Validate Gate (BLOCKING)

For each approved row, draft a SKILL.md using `assets/SKILL.md.tmpl`.
Run the validator:

```
node skills/skila/scripts/validate.mjs <draft-path>
```

If validate exits non-zero, surface all errors and **do not write** the
skill to `~/.claude/skills/`. Fix errors before proceeding.

### Step 5 — Lint Gate (Advisory)

Run the linter on each approved draft:

```
node skills/skila/scripts/lint.mjs <draft-path>
```

Lint warnings are advisory — they never block a proposal, but append
`(WARN: <reason>)` inline next to the row in the multi-select UI.

### Step 6 — Write to Staging

Validated skills are written to `~/.claude/skills/.draft-skila/<name>/`.
The frontmatter MUST include `skila.status: staging`. The web UI
(`skila serve` → port 7777) shows staged skills for review before promotion.

### Step 7 — User Approval + Promotion

Present the multi-select AskUserQuestion with all rows. For each approved
selection:

- `[NEW@global]` → write to `~/.claude/skills/<name>/`
- `[NEW@local]` → write to `<cwd>/.claude/skills/<name>/`
- `[UPDATE→X]` → bump `skila.version`, append to `skila.changelog`,
  set `skila.parentVersion` to prior version, write to published path.
- `[UPDATE→X@staging]` → write to staging tier; explicit `/skila promote`
  or web UI action required to replace the published version.

---

## Quality Bar

Read `references/quality-bar.md` before accepting any proposal. The three
structural rules are:

1. **Deterministic procedures → `scripts/`**: If a workflow step is a
   deterministic, repeatable Node script (FS walk, frontmatter parse, regex
   validation), ship it in `scripts/` and reference it by path in SKILL.md.
   Use `.mjs` wrappers that delegate to `node dist/cli.js`.

2. **Domain knowledge → `references/`**: Stable, enumerable knowledge
   (schema specs, decision criteria, error tables) goes in `references/`.
   SKILL.md body must direct the agent to read the file.

3. **Standardized output → `assets/`**: Templates, prompt scaffolds, and
   row format specifications go in `assets/`. SKILL.md body references them
   by path.

SKILL.md body MUST be ≤ 500 lines. Garbage skills (prose-only stubs with
no artifacts) are rejected at the blocking validate gate.

---

## 5 Superiority Dimensions

skila v2 intentionally inverts five learner-described weaknesses of v1:

| Dimension | v1 Gap | v2 Inversion |
|-----------|--------|--------------|
| **Language** | Python runtime | TypeScript only; `node dist/cli.js` |
| **Iteration** | Fire-and-forget distillation | Every skill carries `skila.changelog`; revisions are visible |
| **Overwrite safety** | Silent replacement of published skills | UPDATE requires web approval or `/skila promote` |
| **Validation** | Advisory Python lint | BLOCKING TypeScript validate gate (exits non-zero) |
| **Feedback** | No usage signal | `~/.claude/skila-data/feedback.json` tracks successRate + invocations |

---

## Staging Tier

New skills land in `~/.claude/skills/.draft-skila/<name>/` with
`skila.status: staging`. Claude Code's loader skips directories whose name
starts with `.`, so staged skills do not load until explicitly promoted.

Auto-promotion to published requires a feedback gate: `successRate ≥ 0.7`
over at least 3 invocations. Manual override is always available via
`/skila promote <name>` or the web UI.

---

## Web UI (`skila serve`)

Run `node dist/cli.js serve` to open the Obsidian-style three-pane control
panel at `http://127.0.0.1:7777`:

- **Left sidebar**: skill list grouped by status (draft / staging / published
  / archived / disabled) with status badges and search filter.
- **Center pane**: CodeMirror 6 markdown editor for SKILL.md + tabs for
  scripts/, references/, assets/.
- **Right inspector**: version timeline, feedback sparkline
  (successRate + usageCount), action buttons (Promote, Archive, Disable,
  Reactivate, Rollback to v0.X).

The web UI is the recommended path for reviewing staged skills before
promotion.

---

## Hooks (Passive Feedback Collection)

Two hooks declared in `plugin.json` run passively:

- **PostToolUse**: records tool invocation outcome to
  `~/.claude/skila-data/feedback.json`.
- **Stop**: records session-end signal.

These hooks are **stateless writers only** — no LLM calls, no skill writes.
All heavier work (judge calls, web ops) is initiated by the user from
`/skila` or the web UI.

---

## Frontmatter Schema (v2)

Every skila-produced SKILL.md MUST include the full v2 schema block.
Read `references/skill-creator-schema.md` for the canonical specification.
Use `assets/SKILL.md.tmpl` as the scaffold when creating new skills.

Required fields: `name`, `description`, `compatibility`, and the full
`skila.*` block (`version`, `status`, `parentVersion`, `revisionCount`,
`lastImprovedAt`, `changelog`, `source`).

---

## File Reference

| Path | Purpose |
|------|---------|
| `scripts/validate.mjs` | Delegate to `node dist/cli.js validate` |
| `scripts/lint.mjs` | Delegate to `node dist/cli.js lint` |
| `scripts/scan.mjs` | Delegate to `node dist/cli.js list` |
| `references/quality-bar.md` | Three structural rules for skill artifacts |
| `references/proposal-criteria.md` | Three promotion criteria (disjunction) |
| `references/skill-creator-schema.md` | Anthropic spec + skila v2 extensions |
| `assets/SKILL.md.tmpl` | Frontmatter scaffold for new skills |
| `assets/prompts/prompt-templates.md` | Distillation + judge prompt templates |
| `assets/proposal-row.tmpl` | AskUserQuestion row format variants |
