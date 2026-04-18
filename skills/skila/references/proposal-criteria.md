# Proposal Criteria — When to Promote a Session Insight into a Skill

Source: spec lines 47–50; research doc `docs/research/hermes-and-memex-study.md` §2.1
(SKILL_MANAGE_SCHEMA "create when..." heuristic — `tools/skill_manager_tool.py:681-701`).

During the distillation pass, evaluate each candidate insight against the three
criteria below. **Any one criterion is sufficient** — this is a disjunction, not
a conjunction. Do not require all three to be satisfied simultaneously.

---

## Criterion 1 — Complex or Non-Trivial Task That Succeeded

Promote when: the session contained a **multi-step, multi-tool workflow** that
required overcoming errors, adapting approach mid-stream, or coordinating several
operations in a specific order — and it succeeded.

Signal phrases (Hermes-style, `tools/skill_manager_tool.py:681-701`):
- 5 or more tool calls in sequence to accomplish one goal
- At least one error was encountered and overcome
- The approach required iteration (first attempt failed or was corrected)
- Non-obvious ordering of steps (e.g. validate before write, scan before propose)

**Example that qualifies**: a session that walked a skill inventory, ran frontmatter
validation, surfaced a lint warning, rendered a diff, and wrote a new skill atomically
— multiple tools, ordering matters, errors possible at each step.

**Example that does not qualify**: a single-step lookup ("what does flag X do in
`git log`?") — trivial, no procedure to encode.

---

## Criterion 2 — Reusable Workflow Likely to Recur

Promote when: the workflow is **likely to be needed again** in future sessions,
even if it was simple this time.

Signal phrases:
- The task is domain-routine for this project or user
- The same sequence of steps would apply next week or next month
- The workflow is parameterizable (same shape, different inputs)

**Example that qualifies**: "every time I add a new skill, I need to validate
frontmatter and update the inventory" — even if the current session was quick,
the recurrence justifies encoding it.

**Example that does not qualify**: a one-off migration script for a legacy
data format that will never appear again.

---

## Criterion 3 — User Correction or Stated Preference

Promote when: the user **corrected the agent's approach** or **stated a preference**
that should persist as a future default.

Signal phrases:
- "No, do it this way instead…"
- "Always use X format when…"
- "Don't do Y, use Z"
- Explicit "remember this" or "save this for next time"

**Example that qualifies**: user says "when you write proposal rows, always include
the line count estimate" — encode this preference into `assets/proposal-row.tmpl`
and the distillation prompt.

**Example that does not qualify**: agent made a typo and user asked for a fix —
a correction to output content, not to procedure or preference.

---

## Any One Suffices

Apply the criteria as a disjunction:

```
promote = criterion_1 OR criterion_2 OR criterion_3
```

Do not penalize a simple insight because it fails criterion 1 (complexity).
Do not require a stated preference to also be reusable. One satisfied criterion
is enough to generate a candidate row.

---

## Empty Result Is Valid

If no insight from the session satisfies **any** of the three criteria, do not
fabricate a proposal. Emit the following verbatim and exit cleanly:

> no skill worth crystallizing

This is a first-class outcome (spec line 51, R8). An empty distillation is not
a failure — it means the session was appropriately simple or its insights are
already encoded in existing skills.
