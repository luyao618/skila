# Quality Bar — What Belongs in scripts/, references/, assets/

Adapted from v1 (commit 6196c44); updated for v2 schema and staging tier.

The quality bar prevents "garbage skills" — pure prose stubs with no bundled
artifacts, no deterministic procedures, and no reusable knowledge. Every skill
that passes `node dist/cli.js validate` must also satisfy the three structural
rules below (audited by `node dist/cli.js lint`).

---

## Rule 1 — Deterministic Procedure → `scripts/`

**When it applies**: the workflow has a deterministic, repeatable procedure
whose correct execution does not depend on LLM judgment — filesystem walks,
frontmatter parsing, regex validation, structured output generation.

**Requirement**: ship the procedure as a Node `.mjs` script in `scripts/`.
The SKILL.md body MUST reference it by relative path (e.g.,
`Run scripts/validate.mjs`). Scripts MUST be Node only — no Python.

**Concrete examples**:
- `scripts/validate.mjs` — delegates to `node dist/cli.js validate`; exits
  non-zero on SKILL.md frontmatter errors. Pure stdlib, deterministic.
- `scripts/lint.mjs` — delegates to `node dist/cli.js lint`; advisory output,
  always exits 0 unless validate also fails.
- `scripts/scan.mjs` — delegates to `node dist/cli.js list`; emits the
  current skill inventory as JSON. Deterministic FS walk.

**Anti-pattern**: SKILL.md body that embeds a 30-line inline shell pipeline
without a real script file. If the inline command is > 10 lines of substantive
logic, it belongs in `scripts/`.

---

## Rule 2 — Domain Knowledge → `references/`

**When it applies**: the workflow depends on stable, enumerable domain
knowledge that the agent needs to read and apply — error tables, API
specifications, format references, decision criteria, schema definitions.

**Requirement**: ship the knowledge as a markdown file in `references/`.
The SKILL.md body must direct the agent to read it (e.g.,
`Read references/proposal-criteria.md`).

**Concrete examples**:
- `references/skill-creator-schema.md` — exact v2 frontmatter rules, name
  regex, description length cap. Agent reads this before generating a
  SKILL.md.
- `references/quality-bar.md` (this file) — the three structural rules.
  Agent reads this before accepting a skill proposal.
- `references/proposal-criteria.md` — the three promotion criteria.
  Agent reads this during the distillation pass.

**Anti-pattern**: embedding a 30-row error-code table inside SKILL.md body.
Large reference material inflates the body toward the 500-line cap and makes
the main workflow harder to follow.

---

## Rule 3 — Standardized Output → `assets/`

**When it applies**: the workflow produces structured output whose shape is
fixed enough to template — file scaffolds, prompt skeletons, row formats for
multi-select UIs.

**Requirement**: ship the template or prompt scaffold in `assets/`. The
SKILL.md body must reference it by relative path.

**Concrete examples**:
- `assets/SKILL.md.tmpl` — frontmatter scaffold for new skills; ensures every
  new skill carries the full v2 `skila.*` block from birth.
- `assets/proposal-row.tmpl` — exact row format for AskUserQuestion; prevents
  LLM from improvising the format and breaking the parser.
- `assets/prompts/prompt-templates.md` — distillation prompt + judge prompt;
  re-used on every `/skila` invocation.

**Anti-pattern**: hard-coding a 10-field template inline in SKILL.md body.
Templates drift; a dedicated asset file is the single source of truth.

---

## v2 Additions

Beyond the three structural rules, v2 adds two quality dimensions:

### Staging Tier

Every new skill lands in `~/.claude/skills/.draft-skila/<name>/` with
`skila.status: staging` before any published promotion. The quality bar
applies at staging time — a skill that fails validate cannot be staged.

### Feedback-Driven Evolution

Published skills carry `skila.revisionCount` and `skila.changelog`. A skill
that has never been revised (revisionCount = 0, changelog.length = 1) is
not necessarily low quality, but skills with 0 feedback invocations after
10+ sessions should be flagged for review in the web UI.

---

## Minimum Thresholds (enforced by validate + lint)

| Field | Threshold | Gate |
|-------|-----------|------|
| `name` | `^[a-z0-9][a-z0-9._-]*$`, ≤ 64 chars, == parent dir | BLOCKING |
| `description` | ≤ 1024 chars, ≥ 40 chars | BLOCKING / advisory |
| body | ≤ 500 lines, ≥ 100 chars | advisory |
| `skila.changelog` | non-empty array | advisory |
| `skila.status` | one of draft/staging/published/archived/disabled | BLOCKING |
