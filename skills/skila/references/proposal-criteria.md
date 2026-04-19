# Proposal Criteria — When to Promote a Session Insight

The three criteria below are evaluated as a **disjunction**: any one
criterion is sufficient to promote a candidate to the proposal list.
All three failing is the only reason to drop a candidate.

---

## Criterion 1 — Complex Success (Multi-Step Workflow)

**Definition**: the session involved a multi-step, multi-tool workflow that
succeeded and whose steps are non-obvious enough that a future agent would
benefit from having them pre-packaged.

**Signals**:
- The agent called ≥ 3 distinct tools in sequence to achieve a single goal.
- The workflow produced a concrete artifact (file, commit, PR, report).
- The user expressed satisfaction ("that worked", "perfect", "ship it").

**Examples**:
- Distilling a session into a SKILL.md: read memory → scan inventory → judge
  → validate → write → propose.
- Setting up a new monorepo: scaffold → configure tsconfig → add scripts →
  wire CI → commit.

**Non-examples**:
- A single `grep` call that found a file.
- A one-shot code explanation with no tool use.

---

## Criterion 2 — Reusable Workflow (Recurrence Likely)

**Definition**: the workflow or decision pattern observed in the session is
likely to recur in future sessions, either for this user or for other users
of the same codebase.

**Signals**:
- The workflow is domain-general (applies across projects).
- The user has performed a similar workflow in prior sessions (visible from
  installed skill names or explicit user statement).
- The workflow is tied to a tool or framework the user uses regularly.

**Examples**:
- "Every time I start a new TypeScript project I do these 7 steps."
- Reviewing a PR with a consistent checklist.
- Running a specific test + lint + build pipeline.

**Non-examples**:
- A one-off migration of a specific file from format A to format B.
- Debugging a specific bug that is now fixed.

---

## Criterion 3 — User Correction or Stated Preference

**Definition**: the user corrected the agent's behavior or explicitly stated
a preference that should persist across sessions.

**Signals**:
- The user said "don't do X" or "always do Y" or "I prefer Z".
- The agent made a mistake and the user corrected it, and the correction
  reveals a stable preference rather than a one-time fix.
- The user provided a format, naming convention, or style rule.

**Examples**:
- "Always use `node:child_process` instead of shell strings."
- "Commit messages should follow Conventional Commits with a `feat(scope):`
  prefix."
- "Never add Python scripts — this repo is TypeScript only."

**Non-examples**:
- "Try again" (retry, not a preference).
- "Use a different variable name here" (one-time cosmetic).

---

## Application

Evaluate all three criteria against the session memory. For each candidate:

1. If **any one** criterion is satisfied → include in the proposal list.
2. If **none** is satisfied → drop silently (do not surface to the user).

Apply the Wave-1 soft cap of 8 rows. If > 8 candidates pass, keep the 8
highest-confidence rows and collapse the rest into:
```
[+N more low-confidence candidates omitted]
```
