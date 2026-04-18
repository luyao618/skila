# Hermes & Memex Study — Phase 0 Research (Anti-Drift Anchor)

- Plan: `/Users/yao/work/code/personal/skila/.omc/plans/skila-implementation-plan.md`
- Spec: `/Users/yao/work/code/personal/skila/.omc/specs/deep-interview-skila-distill.md`
- Status: **Phase 0 hard-gate deliverable**. No code may land in `skills/`, `src/`, or `.claude-plugin/` until this doc is committed.

---

## 1. Purpose & R-DOC Contract

This document discharges the three R-DOC obligations from the spec/plan. **R-DOC-1**: it is the hard gate — no implementation file (anything under `skills/`, `src/`, or `.claude-plugin/`) may be created before this file is committed. **R-DOC-2**: every cross-project insight is recorded as an explicit `BORROW` / `DIVERGE` / `DEFER` decision with a source-line anchor. **R-DOC-3**: every subsequent implementation commit must cite the section here that justifies the choice; deviations are appended as Decision Updates rather than silently changing direction. The two reference projects are **hermes-agent** (Python, agent-managed `skill_manage` tool) and **memex** (TypeScript, Stop-hook-driven Zettelkasten plugin) — they bracket skila's design space and ground every borrow.

---

## 2. Hermes-agent Study

### 2.1 `tools/skill_manager_tool.py` — agent-managed skill CRUD

**SKILL_MANAGE_SCHEMA "create when..." heuristic** — `tools/skill_manager_tool.py:681-701`. The tool description doubles as the LLM's induction prompt: it tells the model *when* to materialize a skill (5+ tool calls, errors overcome, user-corrected approach, non-trivial workflow, explicit user request) and *when* to skip (simple one-offs). This is the same quality bar skila adopts in spec lines 47–50.

```python
"Create when: complex task succeeded (5+ calls), errors overcome, "
"user-corrected approach worked, non-trivial workflow discovered, "
"or user asks you to remember a procedure.\n"
"Update when: instructions stale/wrong, OS-specific failures, "
"missing steps or pitfalls found during use. "
```

**`_validate_frontmatter()`** — `tools/skill_manager_tool.py:150-186`. Deterministic frontmatter gate: requires `---` opener and closer, parses YAML, requires `name` + `description`, caps description ≤ `MAX_DESCRIPTION_LENGTH` (1024), insists on a non-empty body. This is the exact contract `validate_skill.py` (Phase 2, BLOCKING) must satisfy.

```python
if "name" not in parsed:
    return "Frontmatter must include 'name' field."
if "description" not in parsed:
    return "Frontmatter must include 'description' field."
if len(str(parsed["description"])) > MAX_DESCRIPTION_LENGTH:
    return f"Description exceeds {MAX_DESCRIPTION_LENGTH} characters."
```

**`_find_skill()`** — `tools/skill_manager_tool.py:211-226`. Existing-skill lookup is a recursive `rglob("SKILL.md")` over every configured skills dir, matching `skill_md.parent.name == name`. Naive but correct because skill dir names are the canonical key. Skila must do similar — but on the LLM-judged-similarity path, NOT exact match (R6).

```python
for skills_dir in get_all_skills_dirs():
    if not skills_dir.exists():
        continue
    for skill_md in skills_dir.rglob("SKILL.md"):
        if skill_md.parent.name == name:
            return {"path": skill_md.parent}
return None
```

**`_create_skill()`** — `tools/skill_manager_tool.py:304-358`. Validation order: name → category → frontmatter → size → collision → mkdir → atomic write → security scan (rollback on fail). The collision check makes `create` strictly NEW; updates take a different path (`_edit_skill`/`_patch_skill`).

**`_security_scan_skill()`** — `tools/skill_manager_tool.py:56-74`. Post-write scan via `tools.skills_guard.scan_skill`; treats `allowed=False` and `allowed=None` (ask-verdict) as block, with rollback by `shutil.rmtree`. Skila DEFERS this — v1 trusts agent-authored content and only validates frontmatter/structure.

```python
result = scan_skill(skill_dir, source="agent-created")
allowed, reason = should_allow_install(result)
if allowed is False:
    report = format_scan_report(result)
    return f"Security scan blocked this skill ({reason}):\n{report}"
```

**`VALID_NAME_RE`** — `tools/skill_manager_tool.py:101`. The naming rule is `r'^[a-z0-9][a-z0-9._-]*$'` with `MAX_NAME_LENGTH=64` (`tools/skill_manager_tool.py:83`). Skila adopts the same regex in `validate_skill.py`.

```python
VALID_NAME_RE = re.compile(r'^[a-z0-9][a-z0-9._-]*$')
```

**`MAX_SKILL_CONTENT_CHARS`** — `tools/skill_manager_tool.py:97`. 100,000-char ceiling on SKILL.md (~36k tokens at 2.75 chars/token). Skila's spec uses a stricter line-count rule (≤500 lines) but the char ceiling is a useful belt-and-suspenders.

```python
MAX_SKILL_CONTENT_CHARS = 100_000   # ~36k tokens at 2.75 chars/token
MAX_SKILL_FILE_BYTES = 1_048_576    # 1 MiB per supporting file
```

**Atomic write** — `tools/skill_manager_tool.py:268-297`. `tempfile.mkstemp` in same directory, write via `os.fdopen`, then `os.replace(temp_path, file_path)`; cleans up temp on failure. Skila DIVERGES: same property is achieved with shell `mv` of a sibling tmp on the same fs (R15), no Python helper.

### 2.2 `agent/skill_commands.py` — slash-command discovery

**`scan_skill_commands()`** — `agent/skill_commands.py:209-271`. Walks every skills dir for `SKILL.md`, parses frontmatter, applies platform compatibility filter, dedups by `name`, and registers `/cmd-name` → `{name, description, skill_md_path, skill_dir}`. Skila's `scan_inventory.py` mirrors this walk (sans the platform filter and registration side-effects).

```python
for scan_dir in dirs_to_scan:
    for skill_md in scan_dir.rglob("SKILL.md"):
        if any(part in ('.git', '.github', '.hub') for part in skill_md.parts):
            continue
        content = skill_md.read_text(encoding='utf-8')
        frontmatter, body = _parse_frontmatter(content)
        name = frontmatter.get('name', skill_md.parent.name)
```

**Slugify logic** — `agent/skill_commands.py:21-23, 256-258`. Lower-case + replace spaces/underscores with `-`, strip non `[a-z0-9-]`, collapse multi-hyphens, strip leading/trailing `-`. Skila reuses this exact pipeline for `argument-hint`-style normalization in `scan_inventory.py`.

```python
cmd_name = name.lower().replace(' ', '-').replace('_', '-')
cmd_name = _SKILL_INVALID_CHARS.sub('', cmd_name)
cmd_name = _SKILL_MULTI_HYPHEN.sub('-', cmd_name).strip('-')
```

### 2.3 `skills/` directory shape

`/Users/yao/work/code/awesome-project/hermes-agent/skills/` is organized into category dirs (`apple/`, `autonomous-ai-agents/`, `creative/`, `data-science/`, `devops/`, `dogfood/`, `domain/`, `email/`, `feeds/`, `gaming/`, `gifs/`, `github/`, `mcp/`, `media/`, `mlops/`, `note-taking/`, …) — each leaf skill is a directory with `SKILL.md` + optional `references/`, `templates/`, `scripts/`, `assets/`. Representative leaf: `skills/dogfood/SKILL.md` plus `skills/dogfood/references/` and `skills/dogfood/templates/`. Skila DIVERGES from category nesting (flat `<name>/` only), keeps the four optional subdirs.

---

## 3. Memex Study

### 3.1 `.claude-plugin/plugin.json`

`/Users/yao/work/code/awesome-project/memex/.claude-plugin/plugin.json:1-12` — the entire manifest:

```json
{
  "name": "memex",
  "description": "Zettelkasten-based agent memory system with bidirectional links",
  "version": "0.1.29",
  "license": "MIT",
  "keywords": ["memory", "zettelkasten", "agent", "knowledge-management"]
}
```

Six fields, no MCP server requirement, no tool declarations. Skila BORROWS this minimalism for `.claude-plugin/plugin.json` in Phase 1 (plan §3 Phase 1).

### 3.2 `skills/memex-retro/SKILL.md` — distillation prompt shape

`/Users/yao/work/code/awesome-project/memex/skills/memex-retro/SKILL.md:1-5` — frontmatter shape uses `name`, `description`, **plus a non-standard `whenToUse` field** that tells the agent *when* to invoke proactively. Skila adopts the standard `description` + `argument-hint` (R5) and folds the "when" guidance into the description body (Anthropic spec doesn't define `whenToUse`).

```yaml
---
name: memex-retro
description: Save insights from completed tasks to Zettelkasten memory.
whenToUse: After completing any task involving code changes, ...
---
```

**Fact Hygiene Check** — `skills/memex-retro/SKILL.md:52-56`. The three-question filter (WHO / WHAT-WHEN / RELATIONSHIP) that gates each candidate before write:

```markdown
- **WHO**: Every project/product/team mentioned — is it the user's own work or external?
- **WHAT-WHEN**: Every number (days, tokens, cost) — is it bound to a specific project name and time period?
- **RELATIONSHIP**: Words like "对标/参照/基于/借鉴/reference" — spell out the actual relationship
- If any answer is "a stranger couldn't tell", **fix the draft before writing**.
```

Skila BORROWS the *shape* (a pre-write quality gate) but rewrites it into spec-aligned criteria (`references/proposal-criteria.md`): complex success / reusable workflow / user correction-or-preference (spec lines 47–50).

**Dedup digraph** — `skills/memex-retro/SKILL.md:25-47, 57-58`. Search → read candidates → "covers same insight?" diamond → update vs new branch. Skila adopts the same shape but the "covers same insight?" judgment is **pure LLM** over the inventory (R6), not keyword search.

### 3.3 `src/commands/write.ts` — required fields & write contract

**`REQUIRED_FIELDS`** — `src/commands/write.ts:6`. Memex requires `["title", "created", "source"]` and auto-fills `modified` to today's date (`src/commands/write.ts:22-26`). Skila DIVERGES: required fields are Anthropic's `name` + `description` (R5); skila does NOT track timestamps.

```typescript
const REQUIRED_FIELDS = ["title", "created", "source"];
...
const missing = REQUIRED_FIELDS.filter((f) => !(f in data));
if (missing.length > 0) {
  return { success: false, error: `Missing required fields: ${missing.join(", ")}` };
}
```

### 3.4 `src/lib/store.ts` — slug, path-safety, atomic write

**`validateSlug`** — `src/lib/store.ts:16-49`. Rejects empty, dot-only, OS-reserved chars (`: * ? " < > |`), leading/trailing/duplicate separators, and `.` / `..` segments. Skila reuses the spirit of these rules but defers to hermes' simpler `VALID_NAME_RE` for skill names (single-segment, no path).

```typescript
if (RESERVED_CHARS.test(trimmed)) {
  throw new Error("Invalid slug: contains reserved characters (: * ? \" < > |)");
}
for (const seg of segments) {
  if (seg === "." || seg === "..") {
    throw new Error("Invalid slug: path segments must not be '.' or '..'");
  }
}
```

**`assertSafePath`** — `src/lib/store.ts:119-125`. Resolves both target and root, requires `target.startsWith(root + sep)`. Skila uses the same idiom inline in `validate_skill.py` (resolve & startswith) to refuse writes outside `~/.claude/skills/` or `<cwd>/.claude/skills/` (AC15).

```typescript
private assertSafePath(targetPath: string): void {
  const resolved = resolve(targetPath);
  const cardsResolved = resolve(this.cardsDir);
  if (!resolved.startsWith(cardsResolved + sep) && resolved !== cardsResolved) {
    throw new Error(`Invalid slug: path escapes cards directory`);
  }
}
```

**`CardStore.writeCard` atomic write** — `src/lib/store.ts:127-138`. Validate slug → resolve existing → assert-safe → mkdir parent → `writeFile(tmp)` → `rename(tmp, target)` → invalidate cache. Skila BORROWS the **tmp+rename** pattern but renders it as bash `mv` (R15) inline in SKILL.md plan-text — no helper.

```typescript
const tmpPath = targetPath + ".tmp";
await writeFile(tmpPath, content, "utf-8");
await rename(tmpPath, targetPath);
this.invalidateCache();
```

### 3.5 `hooks/hooks.json` — Stop hook (referenced for divergence)

`/Users/yao/work/code/awesome-project/memex/hooks/hooks.json:14-24` — memex auto-triggers retro at every Stop event:

```json
"Stop": [
  {"matcher": "",
   "hooks": [{"type": "command",
              "command": "echo '## 🧠 Memex Retro Reminder ... you MUST invoke the `memex-retro` skill NOW...'"}]}
]
```

Skila DIVERGES (R3): no Stop hook, no SessionStart hook. Trigger is **only** the user-typed `/skila` slash command. Rationale: avoid unsolicited skill induction; user agency over which sessions get distilled.

---

## 4. Borrow / Diverge / Why Matrix

| Insight | Source (file:line) | Skila decision | Why |
|---|---|---|---|
| Skill induction trigger | `tools/skill_manager_tool.py:683-700` (LLM-judged via tool schema) vs `hooks/hooks.json:14-24` (Stop hook) | **DIVERGE** → user-typed `/skila` slash command only | R3 / R19: no auto-trigger; preserves user agency; avoids per-Stop noise |
| SKILL.md required frontmatter fields | `tools/skill_manager_tool.py:175-180` (`name`, `description`) | **BORROW** verbatim | Aligns with Anthropic skill-creator spec (R5); deterministic in `validate_skill.py` |
| Description length cap (1024) | `tools/skill_manager_tool.py:84,179-180` | **BORROW** | Same constant in `validate_skill.py` (AC4) |
| Skill name regex | `tools/skill_manager_tool.py:101` (`^[a-z0-9][a-z0-9._-]*$`) | **BORROW** | Filesystem-safe, URL-friendly, matches Anthropic convention |
| Atomic write technique | `tools/skill_manager_tool.py:268-297` (`tempfile.mkstemp` + `os.replace`) and `src/lib/store.ts:127-138` (`writeFile(tmp)` + `rename`) | **BORROW** semantics, **DIVERGE** mechanism | R15 collapses to bash `mv` of sibling tmp (POSIX-atomic same-fs); no helper script needed |
| Update-vs-create semantics | `tools/skill_manager_tool.py:211-226` (exact-name match) vs memex `skills/memex-retro/SKILL.md:57-58` (agent-driven dedup) | **DIVERGE** → pure LLM similarity over `(name, description)` pairs | R6: forbids embeddings/tags; LLM judgment fits in-context inventory pass |
| Plugin manifest minimalism | `.claude-plugin/plugin.json:1-12` (6 fields, no MCP) | **BORROW** | R9: matches memex shape; zero install friction |
| Security scan posture | `tools/skill_manager_tool.py:56-74` (post-write scan, rollback on block) | **DEFER** to v2 | v1 trusts agent-authored content; spec doesn't mandate; keeps install footprint small |
| Lint posture | n/a (hermes has no advisory lint) | **DIVERGE** → `lint_skill.py` always exits 0 | R17: heuristics never block; warnings inline next to Wave-1 row |
| Validation posture | `tools/skill_manager_tool.py:150-186` (returns error → caller refuses write) | **BORROW** | R18: BLOCKING — non-zero exit ⇒ no write |
| Distillation prompt shape | `skills/memex-retro/SKILL.md:25-58` (digraph + Fact Hygiene Check) | **BORROW** shape, **DIVERGE** content | Replace WHO/WHAT-WHEN/RELATIONSHIP with spec criteria (complex success / reusable / user-correction); R7 |
| Frontmatter `whenToUse` field | `skills/memex-retro/SKILL.md:4` | **DIVERGE** | Anthropic spec only defines `name`, `description`, `argument-hint`; fold "when" into description |
| Storage layout | hermes single root `~/.hermes/skills/` (`tools/skill_manager_tool.py:79-81`); memex `~/.memex/cards/` | **DIVERGE** | R4: dual-scope `~/.claude/skills/<name>/` + `<repo>/.claude/skills/<name>/`; scope baked into Wave-1 row variant |
| Subdirectory taxonomy | `tools/skill_manager_tool.py:104` (`{references, templates, scripts, assets}`) | **BORROW** with reduction → drop `templates/`; rename intent: scripts=deterministic, references=knowledge, assets=output | Spec lines 27–38 codify the three-way split |
| Path-safety check | `src/lib/store.ts:119-125` (`resolve` + `startsWith`) | **BORROW** | Same idiom in `validate_skill.py` to enforce AC15 |
| Slug normalization | `agent/skill_commands.py:21-23, 256-258` | **BORROW** | Reuse pipeline for inventory normalization |
| Slugify reserved-char rejection | `src/lib/store.ts:4, 28-30` | **DEFER** to hermes regex | Skila names are single-segment; hermes regex already covers it |
| Required-fields gating | `src/commands/write.ts:6, 16-19` | **BORROW** pattern | Same shape in `validate_skill.py`: list missing fields, return error |
| Skill directory shape | hermes `skills/<category>/<name>/` (`/Users/yao/work/code/awesome-project/hermes-agent/skills/`) | **DIVERGE** → flat `<name>/` only | Spec keeps it simple; categories deferred |
| Test/fixture strategy | hermes/memex unit-test write paths in their own runtimes; neither tests SKILL.md plan-text | **DIVERGE** → fixture-driven `tests/bin/skila_dryrun.py` shim emits AskUserQuestion JSON | Plan §3 Phase 4: 16/16 ACs scriptable; LLM-quality NOT covered |
| Auto-sync after write | `src/commands/write.ts:30` (`autoSync`) | **DEFER** | R19: no cross-machine sync in v1 |

---

## 5. Decision Record

**Adopted: Option B — Hybrid pure-skill plus three stdlib Python scripts (`validate_skill.py`, `scan_inventory.py`, `lint_skill.py`).**

Rationale (linking back to plan §2): Option A (pure-skill markdown only) cannot reliably enforce R18 (BLOCKING frontmatter validation) by prompt discipline alone, and inventory scanning in pure prose is fragile across hosts. Option C (full TypeScript CLI like memex) imposes a `node ≥18` + `npm install` + build pipeline that is unjustified by any acceptance criterion and contradicts decision-driver 3 (lowest install/maintenance friction). Option B uniquely satisfies all three drivers: deterministic validation (driver 2) without a node toolchain (driver 3), with POSIX `mv` of a same-fs sibling tmp providing atomicity (driver 1) — no helper script can improve on that property. The three-script floor is the smallest defensible set; AC16 mechanically enforces "no shell-idiom wrappers" (>10 substantive LOC each). If future Phase-N work shows TypeScript machinery is essential, the pivot lands as a Decision Update per R-DOC-3.

---

## 6. Open Questions / Decision Updates

## Decision Updates

_Future deviations from this plan are appended here per R-DOC-3._

---

## 7. Trace Matrix

## Trace Matrix (R1..R19 → implementation)

_Filled during Phase 5 per US-006._
