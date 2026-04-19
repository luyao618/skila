# Prompt Templates

Reusable prompt scaffolds for skila's distillation and judge passes.

---

## Distillation Prompt

Used in Step 2 of the `/skila` workflow to extract skill candidates from
session memory and tool trace.

```
You are a skill distillation agent. Your task is to extract reusable workflow
candidates from the current session context.

### Input

**Session memory (in-context only)**:
<session_memory>
{{SESSION_MEMORY}}
</session_memory>

**Last 30 tool trace entries**:
<tool_trace>
{{TOOL_TRACE_JSON}}
</tool_trace>

### Task

1. Read the proposal criteria:
   - Criterion 1: Multi-step, multi-tool workflow that succeeded.
   - Criterion 2: Reusable workflow likely to recur.
   - Criterion 3: User correction or stated preference.

2. For each candidate that passes at least one criterion, output a JSON object:
   {
     "name": "<slug ^[a-z0-9][a-z0-9._-]*$ ≤64 chars>",
     "description": "<pushy ≤1024 chars, explicit triggering cues>",
     "body_outline": "<1-3 sentence summary of the workflow steps>",
     "criterion_met": 1 | 2 | 3,
     "confidence": 0.0-1.0
   }

3. Return a JSON array of candidates, ordered by confidence descending.
   Apply the Wave-1 soft cap: include at most 8 candidates.

### Output format

Return ONLY valid JSON. No prose before or after.

[
  { "name": "...", "description": "...", "body_outline": "...", "criterion_met": 1, "confidence": 0.9 },
  ...
]
```

---

## Judge Prompt

Used in Step 3 of the `/skila` workflow to classify each candidate as
NEW or UPDATE and resolve scope.

```
You are a skill classification judge. Classify each candidate against the
existing skill inventory.

### Inputs

**Current skill inventory**:
<inventory>
{{INVENTORY_JSON}}
</inventory>

**Candidate to classify**:
<candidate>
{{CANDIDATE_JSON}}
</candidate>

**Last 30 tool trace entries**:
<tool_trace>
{{TOOL_TRACE_JSON}}
</tool_trace>

### Classification Rules

1. Emit `UPDATE` only when the candidate's workflow is a direct revision,
   extension, or correction of an existing skill. The target name MUST
   exactly match a `name` field in the inventory. If unsure, prefer `NEW`.

2. For `NEW` candidates, decide scope:
   - `global` if the workflow is domain-general and useful across projects.
   - `local` if the workflow is repo-specific (depends on local paths,
     project conventions, or a specific codebase).
   - Both if genuinely ambiguous — emit two rows.

3. Suggest a version bump for UPDATE:
   - `patch` for bug fix / minor wording improvement
   - `minor` for new step or new reference added
   - `major` for workflow restructure or breaking change

### Output format

Return ONLY valid JSON matching this shape:

{
  "decision": "NEW" | "UPDATE",
  "target_name": "<existing skill name>" | null,
  "scope": "global" | "local" | "both",
  "similarity": 0.0-1.0,
  "justification": "<1-2 sentences>",
  "suggested_version_bump": "patch" | "minor" | "major"
}
```
