# skila
**Self-Improving Skill Inventory Controller** — distill any Claude Code session into production-ready skill packages with one slash command.

---

## What it does

`/skila` scans your current Claude Code session memory, applies three quality
criteria (complex success / reusable workflow / user correction-or-preference),
and proposes 0-to-N **Anthropic-spec skill packages** — not docs, not notes, but
complete `SKILL.md` + `scripts/` + `references/` + `assets/` directories ready
to drop into `~/.claude/skills/` or `<repo>/.claude/skills/`. You pick what to
keep via a two-wave interactive prompt; skila validates every proposal with a
blocking frontmatter check before writing, and performs each write as an atomic
POSIX rename.

---

## Quickstart

### Install

```bash
claude plugin install https://github.com/luyao618/skila
```

Requires: Python ≥ 3.9 (stdlib only — no `pip` step).

### Invoke

In any Claude Code session, type `/skila`. You'll see a Wave-1 multi-select:

```
Pick proposals to apply (multi-select):

  [NEW@global] azure-pipeline-debug — Debug Azure Pipelines from CC: parse YAML, tail
               logs, re-run failed stages. (~120 lines, medium)
  [NEW@local]  skila-dryrun-fixtures — Maintain skila dry-run fixture files for this
               repo. (~60 lines, low)
  [UPDATE→memex-retro] memex-retro — Add "R-DOC-3 cite" guidance to the retro
               procedure. (~+15 lines, low)
```

Accept any UPDATE row and you see Wave-2 with an inline diff:

```
Changes to memex-retro:

  --- a/~/.claude/skills/memex-retro/SKILL.md
  +++ b/~/.claude/skills/memex-retro/SKILL.md
  @@ -47,6 +47,9 @@
   ## Procedure
  +### R-DOC-3 cite
  +After writing a card, append the research-doc section that justifies ...

  [Apply patch]  [Skip]  [Show full new version]
```

After all choices, skila prints:

```
2 created, 1 updated, 0 skipped, 0 discarded
```

---

## Architecture

```
/skila (in CC session)
   │
   ├─ scripts/scan_inventory.py   →  inventory JSON
   ├─ LLM proposal pass           →  candidates with [NEW@global|local] / [UPDATE→X]
   ├─ AskUserQuestion Wave 1      →  user multi-selects
   ├─ AskUserQuestion Wave 2      →  per-update Apply/Skip/Show
   ├─ scripts/validate_skill.py   →  BLOCKING gate
   └─ atomic mv (POSIX rename)    →  ~/.claude/skills/<name>/  or  <repo>/.claude/skills/<name>/
```

Three helper scripts (stdlib-only Python) cover the deterministic operations;
everything else — distillation, similarity judgment, diff generation, summary —
is expressed as SKILL.md plan-text and executed by the agent's own tools.

---

## How it differs from related work

**hermes-agent** — hermes induces skills automatically whenever the LLM judges a
workflow worth crystallizing (the `skill_manage` tool's own description doubles as
the induction prompt). Skila borrows hermes's quality-bar heuristic verbatim but
diverges by being user-triggered only (`/skila` slash command, no auto-induction)
and by collapsing scope choice into the Wave-1 row variants instead of a separate
question.

**memex** — memex is a Stop-hook-driven Zettelkasten that fires after every
session and saves Zettelkasten cards to `~/.memex/cards/`. Skila diverges by being
user-triggered (not Stop-hook auto-fired), targeting structured Anthropic-spec
skill packages rather than free-form cards, and writing to `~/.claude/skills/`
with a blocking validator gate that memex's card pipeline doesn't need.

---

## Documentation

| Doc | Description |
|-----|-------------|
| [Spec](./.omc/specs/deep-interview-skila-distill.md) | Socratic deep-interview spec — requirements, non-goals, acceptance criteria |
| [Plan](./.omc/plans/skila-implementation-plan.md) | Phased implementation plan with RALPLAN-DR decision record |
| [Research](./docs/research/hermes-and-memex-study.md) | Phase-0 hermes + memex study with Borrow/Diverge/Why matrix and trace matrix |

---

## License & Contributing

MIT — see [LICENSE](./LICENSE).

Contributions welcome. Before adding a script to `skills/skila/scripts/`, check
AC16: every file there must contain > 10 lines of substantive (non-blank,
non-comment) code. Thin shell-idiom wrappers belong inline in `SKILL.md`
plan-text, not as helper scripts. Run `bash tests/run_all.sh` before opening a PR.
