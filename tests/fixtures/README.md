# Test Fixtures

This directory contains fixtures for the skila test suite (US-005).

## Scope boundary

> **JSON shape contracts tested; LLM judgment quality NOT tested.**
>
> These fixtures drive deterministic tests of CLI exit codes, JSON schema shapes,
> field presence, and regex patterns. They do NOT evaluate whether the LLM would
> actually produce good skill proposals from real session text — that requires
> manual dogfooding review.

## Fixture → Acceptance Criterion mapping

| Fixture | AC | Purpose |
|---|---|---|
| `skills/global/azure-pipeline-debug/SKILL.md` | AC4, AC5, AC8 | Valid skill with correct frontmatter; drives validate PASS, scan inventory, and lint PASS |
| `skills/local/local-test-helper/SKILL.md` | AC4, AC8 | Valid local skill; drives validate PASS and scan inventory |
| `skills/malformed/bad-skill/SKILL.md` | AC4 | Missing `description` field; drives validate FAIL |
| `skills/prose-only-fetch-logs/SKILL.md` | AC5 | Has exec-verb "fetch" in description, no scripts/ dir; drives lint WARN |
| `session-empty.md` | AC7 | Session with no reusable insight; drives dry-run "no skill worth crystallizing" |
| `session-single-new.md` | AC6 | One complex task → one [NEW@global] proposal |
| `session-update.md` | AC6, AC10 | Improvement to existing skill → one [UPDATE→azure-pipeline-debug] + Wave-2 diff |
| `session-multi.md` | AC6, AC9, AC11, AC13 | 3 insights → mixed [NEW@global] + [NEW@local] + [UPDATE→] |
| `session-garbage.md` | AC6 | Shallow fetch-and-grep → WARN inline in proposal label |
| `expected/wave1.json` | AC6, AC9, AC11 | Contract JSON for session-multi Wave-1 output |
| `expected/wave2.json` | AC10 | Contract JSON for session-update Wave-2 output |

## Dogfooding note

`session-multi.md` and `session-update.md` are synthetic. They should be replaced
with real Phase-0 dogfooding sessions once enough real sessions have been accumulated.
The fixture shapes (frontmatter, JSON) are stable contracts; the prose content is not.
