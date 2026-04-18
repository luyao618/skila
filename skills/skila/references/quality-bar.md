# Quality Bar — What Belongs in scripts/, references/, assets/

Source: spec lines 27–38; research doc `docs/research/hermes-and-memex-study.md` §2.1, §4.
Subdirectory taxonomy BORROW decision: §4 row "Subdirectory taxonomy".

The quality bar exists to prevent "garbage skills" — skills that are pure prose
telling the agent to run a command, with no bundled artifacts, no deterministic
procedures, and no reusable knowledge. Every skill that passes `validate_skill.py`
must also satisfy the three structural rules below (audited by `lint_skill.py`).

---

## Rule 1 — Deterministic Procedure → `scripts/<name>.py` or `scripts/<name>.sh`

**When it applies**: the workflow has a deterministic, repeatable procedure whose
correct execution does not depend on LLM judgment — filesystem walks, frontmatter
parsing, regex validation, structured output generation.

**Requirement**: ship the procedure as a Python or Bash script in `scripts/`.
The SKILL.md body **must** reference it by relative path (e.g. `Run scripts/scan_inventory.py`).

**Concrete examples**:
- `scripts/validate_skill.py` — parses YAML frontmatter, checks `name` regex,
  enforces description ≤ 1024 chars and body ≤ 500 lines. Pure stdlib, exits non-zero
  on failure. Could not be reliably expressed as prompt prose (R18).
- `scripts/scan_inventory.py` — walks `~/.claude/skills/` and `<cwd>/.claude/skills/`,
  parses frontmatter, emits JSON. Deterministic FS walk; fragile as pure prose.
- `scripts/lint_skill.py` — heuristic checks on description + directory shape.
  Always exits 0; advisory output only (R17).

**Anti-pattern**: SKILL.md body that says "run `python3 -c 'import yaml; ...'` in a
one-liner" without a real script file. If the inline command is > 10 lines of
substantive logic, it belongs in `scripts/`.

---

## Rule 2 — Domain Knowledge → `references/<topic>.md`

**When it applies**: the workflow depends on stable, enumerable domain knowledge
that the agent needs to read and apply — error tables, API specifications,
format references, decision criteria, schema definitions.

**Requirement**: ship the knowledge as a markdown file in `references/`.
The SKILL.md body must direct the agent to read it (e.g. `Read references/proposal-criteria.md`).

**Concrete examples**:
- `references/skill-creator-schema.md` (this repo) — exact frontmatter rules, name
  regex, description length cap. Agent reads this before generating a SKILL.md.
- `references/quality-bar.md` (this file) — the three structural rules. Agent reads
  this before accepting a skill proposal.
- `references/proposal-criteria.md` — the three quality criteria for promoting a
  session insight. Agent reads this during the distillation pass.

**Anti-pattern**: embedding a 30-row error-code table inside SKILL.md body.
Large reference material inflates the body toward the 500-line cap and makes
the main workflow harder to follow. Extract it to `references/`.

---

## Rule 3 — Standardized Output → `assets/<name>.tmpl`

**When it applies**: the workflow emits structured, repeated outputs — reports,
configuration files, templates, proposal rows — whose format must be consistent
across invocations.

**Requirement**: ship the output template in `assets/`. SKILL.md body must
reference it (e.g. `Fill in assets/SKILL.md.tmpl`).

**Concrete examples**:
- `assets/SKILL.md.tmpl` — Anthropic-spec scaffold the agent fills in when
  creating a new skill. Ensures consistent frontmatter structure every time.
- `assets/proposal-row.tmpl` — exact row-variant strings for the Wave-1
  `AskUserQuestion` (`[NEW@global]`, `[NEW@local]`, `[UPDATE→X]`).
  Prevents formatting drift across sessions.
- `assets/prompts/prompt-templates.md` — prompt skeletons for distillation,
  similarity judgment, and update-patch. Prompts are agent-emitted outputs,
  not domain knowledge the agent reads to learn (moved from `references/` in
  Iteration 2).

**Anti-pattern**: hardcoding the proposal-row format as a prose description
("emit a line starting with [NEW@global] followed by name, em-dash, etc.").
Prose descriptions drift; a template file is the single source of truth.

---

## Anti-Pattern Section — Garbage Skills

A **garbage skill** is a pure-prose SKILL.md that:

1. Tells the agent to run a command (`"Run: git log --oneline -20"`) instead of
   providing a `scripts/` file with the logic.
2. Embeds large reference tables or spec text inline in the body instead of
   using `references/`.
3. Uses vague output descriptions ("emit a summary") instead of a template in
   `assets/`.
4. Has a `description` that is a capability statement with no trigger cues
   (see `references/skill-creator-schema.md` for the good/bad example contrast).

`lint_skill.py` flags garbage-skill signals (advisory, never blocks):
- Description contains action verbs (`fetch`, `run`, `scan`, `grep`, `build`)
  AND `scripts/` directory is absent → `WARN: description implies executable behavior but no scripts/ found`.

---

## Self-Dogfood Note

Skila itself follows Rule 1, Rule 2, and Rule 3:

| Rule | Files |
|---|---|
| Rule 1 (deterministic procedure) | `scripts/validate_skill.py`, `scripts/scan_inventory.py`, `scripts/lint_skill.py` |
| Rule 2 (domain knowledge) | `references/skill-creator-schema.md`, `references/quality-bar.md`, `references/proposal-criteria.md` |
| Rule 3 (standardized output) | `assets/SKILL.md.tmpl`, `assets/proposal-row.tmpl`, `assets/prompts/prompt-templates.md` |

Three scripts, three references, three assets — exactly the minimum defensible set
per AC16 (each script > 10 lines substantive code) and the quality bar above.
