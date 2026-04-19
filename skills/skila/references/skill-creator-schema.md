# Skill Creator Schema Reference

Canonical reference for Anthropic skill frontmatter + skila v2 extensions.

---

## Anthropic Spec — Required Keys

Every valid SKILL.md MUST include these keys in the YAML frontmatter block:

### `name` (required)

- Type: string
- Regex: `^[a-z0-9][a-z0-9._-]*$`
- Max length: 64 characters
- Constraint: MUST equal the parent directory name
- Example: `name: my-skill` in `~/.claude/skills/my-skill/SKILL.md`

### `description` (required)

- Type: string
- Max length: 1024 characters
- Min length: 40 characters (advisory)
- Content: pushy, explicit triggering cues — tell the agent WHEN to use
  this skill. Include the slash command name if one exists.
- Example:
  ```
  "Distill session memory into skill packages. Use when /skila is invoked
  or when the user asks to capture a workflow as a reusable skill."
  ```

### `argument-hint` (optional)

- Type: string
- Purpose: hint shown to the user in the slash command input box
- Example: `argument-hint: "[--scope global|local]"`

---

## skila v2 Extensions

All skila-produced skills MUST include the `compatibility` key and the full
`skila.*` block. These are skila-specific extensions to the Anthropic spec.

### `compatibility` (required by skila)

- Type: object
- Fields:
  - `node`: SemVer range string (e.g., `">=20"`) — required for Node-backed
    skills
  - `python`: SemVer range string (e.g., `">=3.9"`) — required for Python-
    backed skills
- Example: `compatibility: { node: ">=20" }`

### `skila` block (required by skila)

```yaml
skila:
  version: "0.1.0"        # semver string; bumps on each append-and-revise
  status: "draft"          # one of: draft | staging | published | archived | disabled
  parentVersion: null      # semver string of prior version, or null if first
  revisionCount: 0         # integer; increments on each revision
  lastImprovedAt: "ISO-8601"  # e.g. "2026-04-19T00:00:00Z"
  changelog:
    - version: "0.1.0"
      date: "2026-04-19"
      change: "Initial draft from session <id>"
  source: "skila-distill"  # one of: skila-distill | skila-revise | user-edit-via-web | skila-rollback
```

#### Field details

| Field | Type | Constraint |
|-------|------|-----------|
| `version` | string | semver, required |
| `status` | string | one of draft/staging/published/archived/disabled |
| `parentVersion` | string \| null | semver of prior version, or null |
| `revisionCount` | number | integer ≥ 0 |
| `lastImprovedAt` | string | ISO-8601 datetime |
| `changelog` | array | non-empty; each entry has version, date, change |
| `source` | string | one of the four allowed values |

---

## Full v2 Example

```yaml
---
name: my-workflow
description: "Run the full build→test→lint pipeline for this repo. Use /my-workflow or when asked to verify the build is clean. Triggers on: 'check the build', 'run CI locally', 'is everything green'."
argument-hint: "[--fix]"
compatibility: { node: ">=20" }
skila:
  version: "0.2.1"
  status: "published"
  parentVersion: "0.2.0"
  revisionCount: 3
  lastImprovedAt: "2026-04-19T12:00:00Z"
  changelog:
    - { version: "0.1.0", date: "2026-01-10", change: "Initial draft from session abc123" }
    - { version: "0.2.0", date: "2026-02-14", change: "Added --fix flag for auto-formatting" }
    - { version: "0.2.1", date: "2026-04-19", change: "Updated lint step to use new ESLint flat config" }
  source: "skila-revise"
---
```

---

## Validation Rules (enforced by `node dist/cli.js validate`)

1. `name` must be present and match `^[a-z0-9][a-z0-9._-]*$`
2. `description` must be present and ≤ 1024 chars
3. `name` must equal the parent directory name (when validating a directory)
4. `skila` block must be present
5. `skila.status` must be one of the five allowed values
6. `skila.version` must be a string
7. `skila.changelog` must be an array

Any failure causes validate to exit non-zero with a human-readable error list.

---

## Lint Rules (advisory; `node dist/cli.js lint`)

1. `description` should be ≥ 40 chars
2. Body should be ≥ 100 chars
3. `skila.changelog` should be non-empty

Lint warnings never block a proposal but are surfaced inline in the UI.
