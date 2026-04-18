# Skill-Creator Frontmatter Schema

Source anchor: `tools/skill_manager_tool.py:150-186` (validation gate),
`tools/skill_manager_tool.py:83,101` (name rules).
Research doc: `docs/research/hermes-and-memex-study.md` §2.1.

---

## Required Fields

### `name`

- **Type**: string
- **Regex**: `^[a-z0-9][a-z0-9._-]*$`  (VALID_NAME_RE — `tools/skill_manager_tool.py:101`)
- **Max length**: 64 characters  (`MAX_NAME_LENGTH=64` — `tools/skill_manager_tool.py:83`)
- **Must equal**: the parent directory name (e.g. `skills/my-tool/SKILL.md` → `name: my-tool`)
- **Validation**: `validate_skill.py` exits non-zero if `name` is absent, fails the regex,
  exceeds 64 chars, or does not match the parent directory name.

### `description`

- **Type**: string
- **Max length**: 1024 characters  (`MAX_DESCRIPTION_LENGTH` — `tools/skill_manager_tool.py:84,179-180`)
- **Must be "pushy"**: write trigger cues that tell the agent *when* to invoke this skill.
  The description doubles as an induction signal — it must name conditions, not just capabilities.

**Good example** (explicit trigger cue):
```
Invoke when the user types /skila or asks to distill, crystallize, or
save a workflow from the current session into a reusable skill package.
```

**Bad example** (capability statement, no trigger cue):
```
A tool that helps create skill packages from session memory.
```

The good example tells the agent *when* to fire; the bad example only describes *what* it does.

---

## Optional Fields

### `argument-hint`

- **Type**: string
- Displayed to the user in slash-command help.
- Use when the skill accepts a meaningful free-text argument (e.g. a topic, a file path).
- Example: `argument-hint: "[topic to distill]"`

### `compatibility`

- **Type**: YAML object
- Keys are platform/runtime identifiers; values are version constraints.
- Example:
  ```yaml
  compatibility:
    python: ">=3.9"
  ```
- Skila uses `compatibility.python: ">=3.9"` to surface a prereq without blocking install.

---

## Body Rules

- **Length**: ≤ 500 lines (enforced by `validate_skill.py`).
- **Style**: hierarchical headings (`##`, `###`); imperative voice throughout.
  - Write "Do X" not "X is done" or "X should be done".
  - Write "Run `scripts/scan_inventory.py`" not "`scan_inventory.py` is executed".
- **Script references**: reference bundled scripts and assets by **relative path** from the
  skill root, e.g. `scripts/validate_skill.py`, `assets/SKILL.md.tmpl`.
  Never use absolute paths; never assume `$PATH` resolution.
- **Char ceiling**: `MAX_SKILL_CONTENT_CHARS = 100_000` (~36k tokens) is a belt-and-suspenders
  backstop (`tools/skill_manager_tool.py:97`); the 500-line rule is stricter in practice.

---

## File-Tree Convention

```
<skill-name>/
├── SKILL.md               ← required; frontmatter + body
├── scripts/               ← optional; deterministic procedures (Python/Bash)
│   └── <name>.py / <name>.sh
├── references/            ← optional; domain knowledge (error tables, API specs, format refs)
│   └── <topic>.md
└── assets/                ← optional; standardized output templates
    └── <name>.tmpl
```

- `name` in frontmatter must equal `<skill-name>` (the directory).
- `scripts/` files must contain > 10 lines of substantive code (AC16).
- Subdirectory nesting under `assets/` is permitted (e.g. `assets/prompts/`).

---

## Validation Summary

| Check | Tool | Blocking? |
|---|---|---|
| Frontmatter parses as YAML | `validate_skill.py` | yes |
| `name` present, matches dir, passes regex, ≤64 chars | `validate_skill.py` | yes |
| `description` present, ≤1024 chars | `validate_skill.py` | yes |
| Body ≤500 lines | `validate_skill.py` | yes |
| Heuristic quality signals (scripts/ present when description implies exec) | `lint_skill.py` | no (WARN only) |
