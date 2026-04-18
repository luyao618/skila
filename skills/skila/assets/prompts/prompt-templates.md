# Prompt Templates — Three LLM Passes for /skila

These are the exact prompt skeletons the agent emits during the three LLM passes
of the `/skila` workflow. Use `{{PLACEHOLDER}}` syntax; fill in values at runtime.

---

## Pass 1 — Distillation Prompt

Given the session memory and the proposal criteria, identify candidate insights
worth promoting to skill proposals.

```
You are a skill-distillation assistant. Your job is to read the session memory
below and identify insights that satisfy at least one of the three quality
criteria in the proposal-criteria reference.

## Session Memory

{{SESSION_MEMORY}}

## Proposal Criteria (from references/proposal-criteria.md)

{{PROPOSAL_CRITERIA_CONTENT}}

## Task

Identify candidate insights from the session. For each candidate, output a JSON
object in the array below. Output ONLY valid JSON — no prose before or after.

Rules:
- Apply the criteria as a disjunction (any one criterion suffices).
- If no insight meets ANY criterion, output an empty array [].
- Do not invent insights that did not occur in the session.
- Each candidate must cite which criterion (1, 2, or 3) it satisfies and why.

Output format:
[
  {
    "name": "{{SUGGESTED_SKILL_NAME}}",
    "description": "{{PUSHY_DESCRIPTION_WITH_TRIGGER_CUES}}",
    "criterion": {{CRITERION_NUMBER_1_2_OR_3}},
    "criterion_reason": "{{ONE_SENTENCE_WHY_THIS_CRITERION_IS_MET}}",
    "estimated_lines": {{ESTIMATED_SKILL_MD_LINE_COUNT}},
    "complexity": "{{low|medium|high}}",
    "has_scripts": {{true|false}},
    "has_references": {{true|false}},
    "has_assets": {{true|false}},
    "summary": "{{TWO_SENTENCE_SUMMARY_OF_THE_WORKFLOW}}"
  }
]
```

---

## Pass 2 — Similarity-Judgment Prompt

Given the candidate list from Pass 1 and the current skill inventory, classify
each candidate as `[NEW]` or `[UPDATE→<name>]`.

```
You are a skill-deduplication assistant. Your job is to compare a list of
candidate skills against an existing inventory and classify each candidate.

## Candidate Skills (from Pass 1 distillation)

{{CANDIDATES_JSON}}

## Existing Skill Inventory (from scripts/scan_inventory.py)

{{INVENTORY_JSON}}

## Task

For each candidate, output a classification. Use pure LLM judgment over the
(name, description) pairs — do NOT require exact name matches.

Classification rules:
- Output [NEW] when no existing skill covers substantially the same workflow.
- Output [UPDATE→<existing_name>] when an existing skill covers the same or
  overlapping workflow and the candidate would strengthen it.
- When classifying [UPDATE], use the EXISTING skill's name as <existing_name>,
  not the candidate's suggested name.
- A candidate can only map to one existing skill (no many-to-one merges in one pass).

Output ONLY valid JSON — no prose before or after.

Output format:
[
  {
    "candidate_name": "{{CANDIDATE_NAME}}",
    "classification": "{{NEW|UPDATE}}",
    "existing_name": "{{EXISTING_SKILL_NAME_OR_NULL}}",
    "reasoning": "{{ONE_SENTENCE_EXPLAINING_THE_CLASSIFICATION}}"
  }
]
```

---

## Pass 3 — Update-Patch Prompt

Given an existing SKILL.md and a new insight, produce a unified diff that
strengthens the existing skill. Prefer a localized patch over a full rewrite.

```
You are a skill-update assistant. Your job is to integrate a new insight into
an existing skill by producing the smallest diff that adds value.

## Existing SKILL.md

File path: {{EXISTING_SKILL_PATH}}

```
{{EXISTING_SKILL_CONTENT}}
```

## New Insight

Name: {{CANDIDATE_NAME}}
Description: {{CANDIDATE_DESCRIPTION}}
Summary: {{CANDIDATE_SUMMARY}}
Criterion satisfied: {{CRITERION_NUMBER}} — {{CRITERION_REASON}}

## Task

Produce a unified diff (`diff -u` format) that integrates the new insight into
the existing SKILL.md.

Rules:
- Prefer a localized patch (add/modify a section, add a step, add a warning)
  over a full rewrite when the new insight is additive.
- Do a full rewrite ONLY when the existing content is substantially wrong or
  the structure must change to accommodate the insight.
- Preserve the existing frontmatter `name` field exactly.
- The patched SKILL.md must still pass `validate_skill.py` (frontmatter valid,
  description ≤ 1024 chars, body ≤ 500 lines).
- Output ONLY the unified diff — no prose before or after.

Output format:
--- a/{{EXISTING_SKILL_PATH}}
+++ b/{{EXISTING_SKILL_PATH}}
@@ ... @@
 (context lines)
+(added lines)
-(removed lines)
 (context lines)
```
