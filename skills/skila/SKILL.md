---
name: skila
description: "Distill in-context Claude Code session memory into production-ready Anthropic-spec skill packages. Use this skill whenever the user invokes /skila or asks to distill the current session into reusable skills. Presents a multi-select of [NEW@global], [NEW@local], and [UPDATE→<existing>] proposals and writes complete skill packages (SKILL.md + scripts/ + references/ + assets/ as needed) to ~/.claude/skills/ or <repo>/.claude/skills/."
argument-hint: "[--scope global|local]"
---

## Procedure

### 1. Trigger Gate

Only execute this procedure when the user explicitly invokes `/skila`.
If this skill is loaded by any other means (auto-suggestion, ambient load, etc.),
do nothing and return immediately.

### 2. Distill from In-Context Memory

Read `references/proposal-criteria.md` and apply the three criteria to the
agent's **current in-context conversation memory**.

> **IMPORTANT — Do NOT read `~/.claude/projects/` or any JSONL transcript
> file — distillation uses only the agent's current in-context conversation
> memory.** (R-DOC-3 cite: research §4 Borrow/Diverge "transcript reading")

For each workflow, decision pattern, or user preference observed in the session:

1. Evaluate against the three criteria (disjunction — any one suffices):
   - **Criterion 1**: Multi-step, multi-tool workflow that succeeded.
   - **Criterion 2**: Reusable workflow likely to recur.
   - **Criterion 3**: User correction or stated preference that should persist.
2. Collect all candidates that pass at least one criterion.
3. Carry the candidate list forward to Step 3.

### 3. Inventory Scan

Run the inventory scanner to discover all currently installed skills:

```
python3 ${SKILL_DIR}/scripts/scan_inventory.py
```

Capture the resulting JSON list of `{name, description, scope, path}` objects.
If the script exits non-zero, surface the stderr and abort.

### 4. LLM Proposal Pass

Feed the inventory (Step 3) and distilled candidates (Step 2) to the LLM
judgment pass. For each candidate:

**a. Classify as `[NEW]` or `[UPDATE→<existing-name>]`:**

- Emit `[UPDATE→X]` only when `X` exactly matches a `name` field in the
  inventory list returned by Step 3.
- If `X` is not present in the inventory, downgrade the row to `[NEW]`.

**b. Resolve scope for `[NEW]` rows:**

- When both `global` and `local` scopes are plausible for a `[NEW]` candidate,
  emit **two rows**: `[NEW@global]` and `[NEW@local]`.
- When only one scope is plausible, emit one row.

**c. Run `lint_skill.py` per draft:**

```
python3 ${SKILL_DIR}/scripts/lint_skill.py <draft-path>
```

If the result `status` is `WARN`, append `(WARN: <reason>)` inline next to
the row. Lint warnings are **advisory only** — they never block the row from
appearing in the Wave-1 list.

**d. Apply the Wave-1 soft cap of 8 rows:**

- Count all rows that would appear in the Wave-1 list.
- If the count exceeds 8, collapse the lowest-confidence rows into a single
  summary: `[+N more low-confidence candidates omitted]`
- When applying the cap and a `[NEW]` candidate has both `@global` and `@local`
  variants, emit only the more-likely scope (do not double-count).

**Row format** (see `assets/proposal-row.tmpl` for exact template):

```
[NEW@global] <name> — <one-line description>
[NEW@local]  <name> — <one-line description>
[UPDATE→<existing-name>] — <one-line description of the change>
```

### 5. Empty-Result Branch

If zero candidates pass any criterion in Step 2 (no proposal rows produced),
print exactly the following and exit cleanly:

```
no skill worth crystallizing
```

Do not proceed to Step 6.

### 6. Wave 1 — Single Multi-Select `AskUserQuestion`

Present all candidate rows from Step 4 in a **single** `AskUserQuestion`.
The user multi-selects the rows they want to apply.

- Scope is encoded in the row variant (`[NEW@global]` vs `[NEW@local]`).
- Do **NOT** emit a separate scope-choice question after Wave 1.
- Do **NOT** split Wave 1 into multiple questions.
- Do **NOT** add a Wave 3 question of any kind.

Collect the accepted set: `NEW` rows → go to Step 8; `UPDATE` rows → go to
Step 7 first.

### 7. Wave 2 — Per-Accepted `[UPDATE]` Follow-Up

For each accepted `[UPDATE→X]` row:

1. Generate a new SKILL.md draft in memory.
2. Render the diff inline using:
   ```
   diff -u <existing-SKILL.md> <new-draft-SKILL.md>
   ```
   Do **NOT** use a helper script for this — invoke `diff -u` directly.
3. Show the diff in the prompt and present a three-option `AskUserQuestion`:
   - `[Apply patch]`
   - `[Skip]`
   - `[Show full new version]`
4. If the user selects `[Show full new version]`, display the full draft and
   repeat the three-option question.
5. Carry the decision (`apply` / `skip`) forward to Step 8.

### 8. Validate (BLOCKING)

For every accepted proposal (both `[NEW]` and approved `[UPDATE]`), run:

```
python3 ${SKILL_DIR}/scripts/validate_skill.py <draft-path>
```

- On **non-zero exit**: refuse the write for that proposal; surface the full
  `stderr` to the user; continue with remaining proposals.
- On **zero exit**: proceed to Step 9.
- **Never skip this step.** Validate is BLOCKING per R18.

### 9. Atomic Write (Inline — No Helper Script)

For each proposal that passed Step 8:

**a. Determine destination path:**

- `[NEW@global]` → `~/.claude/skills/<name>/SKILL.md`
- `[NEW@local]`  → `<cwd>/.claude/skills/<name>/SKILL.md`
- `[UPDATE→X]`   → the `path` value returned by the inventory for skill `X`

**b. Pre-write backup (for UPDATE only):**

```
cp <dest> <dest>.bak
```

**c. Atomic write:**

```
# Write to temp file on the same filesystem as dest
cat > <dest>.tmp << 'EOF'
<content>
EOF
mv <dest>.tmp <dest>
```

The `mv` is a POSIX-atomic rename within the same filesystem.  Do NOT use a
helper script for this sequence — perform the write and rename inline.

**d. Sibling files (`scripts/`, `references/`, `assets/`):**

For every supporting file produced as part of the skill package, apply the
same `.tmp` → `mv` pattern. Back up any pre-existing file to `<file>.bak`
before overwriting.

### 10. Summary

After all proposals have been processed, print exactly:

```
<N> created, <M> updated, <K> skipped, <L> discarded
```

Where:
- `<N>` = count of `[NEW]` proposals written successfully.
- `<M>` = count of `[UPDATE]` proposals applied successfully.
- `<K>` = count of proposals the user explicitly skipped (Wave 2 `[Skip]`
  or deselected in Wave 1).
- `<L>` = count of proposals that failed Step 8 validation.

---

## Constraints (NEVER violate)

- **Never read `~/.claude/projects/` or JSONL transcripts** (R19, R3).
  Distillation reads only in-context conversation memory.
- **Never write outside `~/.claude/skills/<name>/` or
  `<cwd>/.claude/skills/<name>/`** (R19). No writes to arbitrary paths.
- **Never skip Step 8** — validate is BLOCKING per R18. A proposal that has
  not passed `validate_skill.py` with exit 0 must not be written to disk.
- **Never block a write because of Step 4's lint WARN** — lint is ADVISORY
  per R17. A `WARN` from `lint_skill.py` annotates the row but never prevents
  a write.
- **Never collapse Wave-1 + Wave-2 into a single question**, never split
  Wave-1 into multiple questions, and never add a Wave-3 scope question.

---

## Quality Bar (MUST honor for every produced skill)

Full rules: `references/quality-bar.md`.

Brief restatement:

1. **Rule 1 — Deterministic procedure → `scripts/`**: any repeatable,
   non-LLM-judgment logic must ship as a Python or Bash script in `scripts/`.
2. **Rule 2 — Domain knowledge → `references/`**: stable, enumerable knowledge
   (error tables, API specs, decision criteria) must ship as `.md` files in
   `references/`.
3. **Rule 3 — Standardized output → `assets/`**: structured, repeated outputs
   must ship as template files in `assets/`. Hardcoded prose descriptions of
   output format are an anti-pattern.

---

## References

| File | Purpose |
|---|---|
| `references/skill-creator-schema.md` | Frontmatter schema: `name` regex, `description` length cap, body rules, file-tree convention. |
| `references/quality-bar.md` | Three structural rules (scripts/references/assets) that every produced skill must satisfy. |
| `references/proposal-criteria.md` | Three criteria for promoting a session insight into a skill candidate (disjunction). |

---

## Scripts

| Script | CLI signature | Purpose |
|---|---|---|
| `scripts/scan_inventory.py` | `python3 scan_inventory.py [--cwd <dir>]` | Walk `~/.claude/skills/` and `<cwd>/.claude/skills/`; emit JSON list of `{name, description, scope, path}`. Always exits 0. |
| `scripts/validate_skill.py` | `python3 validate_skill.py <SKILL.md-path>` | BLOCKING validator: parses YAML frontmatter, enforces name regex, description ≤ 1024 chars, body ≤ 500 lines. Exits non-zero on failure with structured stderr. |
| `scripts/lint_skill.py` | `python3 lint_skill.py <SKILL.md-path>` | ADVISORY linter: heuristic quality signals. Always exits 0. Outputs `{"status": "PASS"\|"WARN", "reasons": [...]}`. |

---

## Assets

| File | Purpose |
|---|---|
| `assets/SKILL.md.tmpl` | Anthropic-spec scaffold filled in when creating a new skill. Ensures consistent frontmatter structure. |
| `assets/proposal-row.tmpl` | Exact row-variant strings for the Wave-1 `AskUserQuestion` (`[NEW@global]`, `[NEW@local]`, `[UPDATE→X]`). Single source of truth for row format. |
| `assets/prompts/` | Prompt skeletons for distillation, similarity judgment, and update-patch generation. |
