# Deep Interview Spec v2: skila — Self-Improving Skill Inventory Controller

> **This spec REPLACES `deep-interview-skila-distill.md` (v1).**
> v1 was rejected by the user as a "糊弄 demo" — under-scoped, no web UI, no evolution loop, did not match memex's distribution model. v2 is the corrective.

## Metadata
- Interview ID: skila-v2-2026-04-19
- Rounds: 9 (8 v1 rounds informing baseline + 9 v2 rounds for the corrective scope)
- Final Ambiguity Score: 5.7%
- Type: greenfield (v1 implementation discarded)
- Generated: 2026-04-19
- Threshold: 20%
- Status: PASSED (well below threshold)
- npm package name: **`@yao/skila`** (scope `@yao` available, claimed)

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.97 | 0.40 | 0.388 |
| Constraint Clarity | 0.97 | 0.30 | 0.291 |
| Success Criteria | 0.88 | 0.30 | 0.264 |
| **Total Clarity** | | | **0.943** |
| **Ambiguity** | | | **0.057** |

---

## Goal

Build **skila**, a TypeScript-based Claude Code plugin distributed as `@yao/skila` on npm + Claude plugin marketplace + Smithery, that **outperforms `oh-my-claudecode/learner` along the dimensions where learner is provably weakest**: append-and-revise instead of append-only, feedback-driven evolution instead of fire-and-forget, two-tier draft/published gating instead of write-once-and-trust, semantic LLM judgment instead of regex-only detection, and tool-trace-aware extraction instead of surface-level keyword matching.

Skila ships:
1. A **slash command** `/skila` that distills the agent's in-context session memory into 0/1/N skill proposals (NEW or UPDATE).
2. **Auto-collected feedback hooks** (PostToolUse + Stop) registered via `plugin.json` — zero user configuration after install.
3. A **web control panel** (`skila serve`, default `:7777`) — the *primary* skill management surface, not a read-only viewer like memex's serve. CodeMirror 6 in-browser SKILL.md editor, version timeline, rollback, promote (draft→published), archive, disable/reactivate, feedback dashboards.
4. A **storage layer** that is git-backed when git is available (incremental history, diff, optional cloud backup), automatically degraded to flat-file version directories when git is absent — user-visible behavior is identical.

In one sentence: **a TypeScript Claude Code plugin that turns CC sessions into a continuously-evolving, web-managed skill library, with every learner-described weakness intentionally inverted.**

## Quality Bar (CRITICAL — non-negotiable)

The same Anthropic skill-creator quality bar from v1 still holds: skila MUST emit production-ready skill packages (SKILL.md + scripts/ + references/ + assets/ as appropriate), NOT prose-only stubs. v1's `validate_skill` and `lint_skill` rules are inherited *as TypeScript reimplementations*. Garbage skills are rejected at the BLOCKING validation gate.

Beyond v1's bar, v2 adds:

- **No "fire and forget"**: every produced skill carries `skila.version`, `skila.status`, `skila.changelog`, `skila.parentVersion` in frontmatter. Iteration is visible.
- **No silent overwrite**: an UPDATE that replaces a published skill MUST be approvable from the web (or from `/skila promote`). Auto-promotion is feedback-gated.
- **No "tests pass therefore done"**: validation is gated on a real e2e evolution-path test (see Acceptance Criteria), not just JSON shape contracts.

## Constraints

### Implementation substrate
- **Language**: TypeScript only. v1's Python implementation is discarded entirely.
- **Runtime**: Node.js ≥ 20 (matches memex's de-facto requirement; no `engines` field needed but documented).
- **Dependencies**: prefer zero-dep where possible. Allowed:
  - `node:http` for web (memex pattern, no Express/Fastify).
  - `js-yaml` (or hand-rolled, depending on plan's Architect call) for frontmatter.
  - `commander` (or built-in `node:util.parseArgs`) for CLI.
  - `gray-matter` allowed if frontmatter parsing complexity warrants.
  - **NO React/Vue/Vite** — web UI is a single bundled HTML file with Tailwind CSS via CDN + CodeMirror 6 via CDN, vanilla JS DOM ops.
  - **NO embedding model dependency** — semantic similarity is folded into the LLM judge agent (decision was: option #4 collapsed into option #5 of learner-deep-study.md §8).
  - **NO Python in the runtime path.**
- **Build**: TypeScript → `dist/` via `tsc` only (memex pattern). No esbuild, no webpack. `node dist/cli.js` is the entry.

### Trigger
- Primary: user-initiated `/skila` slash command, uses agent in-context memory only (not transcript files).
- Secondary (NEW in v2): hooks declared in `plugin.json` — `PostToolUse` and `Stop` — collect feedback signals (not skill creation; feedback only).
- The hook collectors are stateless and write only to `~/.claude/skila/feedback.json`. Any heavier work (LLM judge calls, web UI ops) is initiated by the user from `/skila` or the web.

### Storage layout
- Skill files: `~/.claude/skills/<name>/SKILL.md` (published, CC loader picks up) + supporting `scripts/`, `references/`, `assets/`.
- Drafts: `~/.claude/skills/.draft-skila/<name>/SKILL.md` (CC loader skips because `name` starts with `.` AND skill frontmatter has `skila.status: draft`).
- Archived: `~/.claude/skills/.archived-skila/<name>/SKILL.md`.
- Disabled (user-toggled): `~/.claude/skills/.disabled-skila/<name>/SKILL.md`.
- Skila's own data: `~/.claude/skila-data/`:
  - `feedback.json` — high-frequency reads/writes from hooks, NOT in any SKILL.md to avoid CC reload churn.
  - `.git/` — version history (when git available).
  - `versions/<name>/v0.X.Y/SKILL.md` — flat-file fallback when git absent.
  - `config.json` — port number, promotion thresholds, disabled hooks list.
- Per-proposal scope choice (global vs project-local) is preserved from v1.

### Frontmatter schema (v2)
Every skila-produced SKILL.md MUST have:
```yaml
---
name: <slug, ^[a-z0-9][a-z0-9._-]*$, ≤64 chars, == parent dir>
description: <pushy, ≤1024 chars, explicit triggering cues>
compatibility: { node: ">=20" }   # or python>=3.9 if the skill ships python scripts
skila:
  version: "0.1.0"            # semver, bumps on append-and-revise
  status: "draft" | "staging" | "published" | "archived" | "disabled"
  parentVersion: "0.0.0" | null
  revisionCount: 0
  lastImprovedAt: "ISO-8601"
  changelog:
    - { version: "0.1.0", date: "...", change: "Initial draft from session <id>" }
  source: "skila-distill" | "skila-revise" | "user-edit-via-web"
---
```

Feedback data lives **outside** SKILL.md (in `~/.claude/skila-data/feedback.json`) to avoid hook-driven file churn:
```json
{
  "<skill-name>": {
    "successRate": 0.82,
    "usageCount": 17,
    "lastUsedAt": "ISO-8601",
    "invocations": [{ "ts": "...", "outcome": "success"|"failure"|"unknown", "session": "..." }]
  }
}
```

### Web control panel (`skila serve`)
- Server: `node:http`, default port `7777` (memex uses 3939; pick a different port to avoid collision when both installed). Auto-increments on conflict (memex pattern, ~10 lines).
- Bind: `127.0.0.1` only. No auth, no remote in v0.1.
- Single-file UI: `dist/web/index.html` bundled at build time (`postbuild.mjs` copies from `src/web/index.html`), Tailwind CSS via CDN, CodeMirror 6 via CDN, marked via CDN (for rendering changelog markdown).
- Layout: **Obsidian-style three-pane**:
  - Left sidebar: skill list grouped by status (draft / published / archived / disabled) with status badges and search filter.
  - Center: detail view (CodeMirror 6 markdown editor for SKILL.md + tabs for scripts/references/assets).
  - Right inspector: version timeline, feedback metrics (successRate sparkline, usageCount), action buttons (Promote, Archive, Disable, Reactivate, Rollback to v0.X).
- Top bar: dashboard metrics (drafts pending, published count, recent activity, low-success skills flagged).

### API surface (web backend)
- `GET /` → `index.html`
- `GET /api/skills` → list with metadata for sidebar
- `GET /api/skills/:name` → full SKILL.md content + scripts/references/assets file list
- `GET /api/skills/:name/file?path=scripts/foo.py` → individual supporting file content
- `GET /api/skills/:name/versions` → list of versions (git log or flat dir scan)
- `GET /api/skills/:name/diff?from=v0.1.0&to=v0.2.0` → unified diff
- `GET /api/skills/:name/feedback` → feedback.json slice for this skill
- `PUT /api/skills/:name` → save SKILL.md edit (with mtime check; runs validate_skill before write)
- `POST /api/skills/:name/promote` → draft → published (atomic move + git commit if available)
- `POST /api/skills/:name/archive` → published → archived
- `POST /api/skills/:name/disable` → status: disabled
- `POST /api/skills/:name/reactivate` → status: published (from disabled)
- `POST /api/skills/:name/rollback?to=v0.1.0` → restore historical version as new current version (bumps revisionCount, appends to changelog)
- `POST /api/skills/:name/feedback` → manual user feedback (e.g., "this skill was useful")
- `GET /api/dashboard` → aggregated stats for top bar
- All write endpoints validate `skila_token` cookie (set on first GET /, sessionStorage-scoped) — prevents CSRF without full auth complexity.

### Distribution
- Three channels (memex pattern):
  1. **npm**: `@yao/skila` published to npm registry. `npm i -g @yao/skila` installs the CLI.
  2. **Claude plugin marketplace**: `.claude-plugin/plugin.json` declares hooks + slash commands. User runs `/plugin marketplace add yao/skila && /plugin install skila@skila`. Plugin auto-registers MCP server (which proxies to the npm-installed CLI).
  3. **Smithery**: `smithery.yaml` declares `npx -y @yao/skila mcp` so Smithery deploys the MCP server without local install.
- Zero post-install configuration: plugin.json hooks fire automatically; web UI launches with `skila serve` (no config file required).

### Quality criteria (carried from v1)
A skila session insight becomes a proposal when ANY of:
1. Complex/non-trivial multi-step task succeeded.
2. Reusable workflow likely to recur.
3. User correction or stated preference.

The LLM judge agent applies these criteria AND examines the tool-call trace (Edit/Bash/Grep sequence in the recent context), not just natural-language signals — directly addresses the learner-deep-study §3 finding that learner's `detector.ts` is "all surface-level regex/keyword".

### Empty result remains a first-class outcome
If no insight passes criteria, skila prints "no skill worth crystallizing this session" and exits 0.

## Process Constraints (Research-First Development — carried from v1)

- **R-DOC-1 (must precede any implementation)**: `docs/research/` already contains `hermes-and-memex-study.md` and `learner-deep-study.md`. v2 adds:
  - Append a **Decision Update — v2** section to `hermes-and-memex-study.md` documenting the divergences from v1 (TypeScript substrate, web control panel, evolution loop). This MUST be committed BEFORE any TS source file.
- **R-DOC-2**: every borrow/diverge entry in research docs MUST cite source-line anchors.
- **R-DOC-3**: every implementation PR/commit cites the relevant research-doc section as rationale; deviations append "Decision Update".

## Non-Goals (v0.1)

- No automatic skill *creation* via Stop hook — only feedback collection. Skill creation remains explicit `/skila`.
- No reading of `~/.claude/projects/` JSONL transcripts.
- No embedding-based similarity (folded into LLM judge per Round 2).
- No multi-user / remote web access (127.0.0.1 only, no auth).
- No cross-machine sync of skill files (defer to v0.2 — could leverage the git-backed storage).
- No mobile UI (Obsidian-style high-density layout assumes ≥ 1280px width).
- No real-time updates / WebSocket — web UI is request/response, refresh button.
- No skill marketplace / sharing between users.
- No auto-prune (learner declared autoPrune but never implemented; we're explicit it's out of scope for v0.1).

## Acceptance Criteria

### Phase 0 — Research-first hard gate
- [ ] AC1: `docs/research/hermes-and-memex-study.md` has a "Decision Update — v2" section with Borrow/Diverge entries for: TypeScript substrate (was Python), web control panel (was none), npm distribution (was claude plugin only), feedback hooks (was none). Each entry has source-line anchors.
- [ ] AC2: `docs/research/learner-deep-study.md` is referenced as the design north star in the Decision Update; the 5 superiority dimensions are explicitly mapped to AC8–AC12 (append-and-revise, feedback flywheel, two-tier promotion, semantic similarity, tool-trace-aware extraction) below.
- [ ] AC3: `git log --diff-filter=A --name-only` shows the Decision Update commit BEFORE any file added under `src/`, `dist/`, `.claude-plugin/`, or `web/`.

### Phase 1 — Plugin skeleton + npm package
- [ ] AC4: `package.json` declares `"name": "@yao/skila"`, `"bin": { "skila": "dist/cli.js" }`, `"engines": { "node": ">=20" }`, version 0.1.0.
- [ ] AC5: `.claude-plugin/plugin.json` declares the slash command `/skila` AND the two hooks (PostToolUse, Stop) wired to `dist/hooks/feedback.cjs`.
- [ ] AC6: `smithery.yaml` declares `npx -y @yao/skila mcp` with stdio transport.
- [ ] AC7: `npm pack --dry-run` succeeds and the tarball includes `dist/`, `.claude-plugin/`, `smithery.yaml`, `README.md`, `LICENSE`.

### Phase 2 — Five superiority dimensions (one AC per dimension; all REQUIRED for v0.1)
- [ ] AC8 (Append-and-revise, learner gap §7.1): given an existing published skill X, when `/skila` is invoked in a session relevant to X, skila MUST detect the relation and offer `[UPDATE→X v0.1.0 → v0.2.0]` row in Wave 1, NOT a name collision error. Accepting it produces v0.2.0 with `parentVersion: 0.1.0` and a non-empty changelog entry. Verified by `tests/e2e/test_revise_path.ts`.
- [ ] AC9 (Feedback flywheel, learner gap §7.2): when CC invokes a skila-produced skill in a session and the session ends successfully (Stop hook fires), `~/.claude/skila-data/feedback.json` MUST have an updated `successRate` and `usageCount` for that skill within 1 second. Verified by `tests/e2e/test_feedback_loop.ts`.
- [ ] AC10 (Two-tier promotion, learner gap §5): every newly-created skill writes to `.draft-skila/`, NOT directly to published. CC loader does not pick up drafts (verified by checking the draft skill name starts with `.` parent dir). Promotion happens via web UI button, `/skila promote <name>` command, OR auto-promotion when `usageCount ≥ 3 AND successRate ≥ 0.7` (configurable). Verified by `tests/e2e/test_promotion_gate.ts`.
- [ ] AC11 (Semantic similarity, learner gap §4): when proposing UPDATE candidates, skila feeds the LLM judge a) the inventory list, b) the candidate insight, c) the trailing tool-call trace (last 30 tool uses), and asks for a structured JSON of `{decision: NEW|UPDATE→X, similarity: 0..1, justification, suggested_version_bump}`. Verified by inspecting the prompt assembly in `src/judge/prompt.ts` AND `tests/judge/test_judge_prompt.ts` asserting the prompt includes all three inputs.
- [ ] AC12 (Tool-trace-aware extraction, learner gap §3): the distillation pass MUST consume the in-context tool-call sequence (parsed from CC's runtime API or simulated in tests via fixture) — NOT only the natural language. The judge prompt's distillation section explicitly references "tool sequence" as input. Verified by `tests/judge/test_extraction_uses_tool_trace.ts`.

### Phase 3 — Web control panel
- [ ] AC13: `skila serve` starts an HTTP server on `127.0.0.1:7777` (auto-increments on conflict). Stops on Ctrl-C cleanly.
- [ ] AC14: `GET /` returns the bundled HTML; `GET /api/skills` returns valid JSON list including draft + published + archived + disabled.
- [ ] AC15: All write endpoints (PUT /api/skills/:name, POST /promote/archive/disable/reactivate/rollback/feedback) work end-to-end against a real test skill fixture; each one updates skill state on disk AND triggers a git commit (or flat-file version snapshot when git absent).
- [ ] AC16: The CodeMirror 6 editor in the web UI loads, edits, and saves a skill back via PUT, surviving a refresh. Verified by `tests/web/test_editor_e2e.ts` using `agent-browser` skill.
- [ ] AC17: Rollback to a historical version creates a new "current" version (does not destroy v0.X.Y), bumps revisionCount, appends a "Rolled back to v0.X.Y" changelog entry. Verified by `tests/e2e/test_rollback.ts`.
- [ ] AC18: Visual quality gate — the four core pages (dashboard, skill list, skill detail, diff viewer) when screenshotted via `agent-browser` and reviewed via `oh-my-claudecode:visual-verdict` against a reference Obsidian/GitHub-style mockup, score ≥ 7/10. Sub-7 must trigger a `designer` agent rework before AC18 closes.

### Phase 4 — Storage adapter
- [ ] AC19: `src/storage/git.ts` implements GitBackedStorage with: `init()`, `commit(message, files[])`, `listVersions(name)`, `getVersion(name, ref)`, `diff(name, ref1, ref2)`. Uses `child_process.execFile('git', ...)` (no `simple-git` dependency) for transparency.
- [ ] AC20: `src/storage/flat.ts` implements FlatFileStorage with the same interface; falls back to `~/.claude/skila-data/versions/<name>/v0.X.Y/SKILL.md` directories.
- [ ] AC21: `src/storage/index.ts` factory checks `git --version` at startup and selects the adapter; logs the choice once, never warns again. Verified by `tests/storage/test_adapter_selection.ts` running both with-git and without-git modes.
- [ ] AC22: All storage writes are atomic (temp file + `fs.rename`); a kill -9 mid-write leaves the file in either the old or new state, never half-written. Verified by `tests/storage/test_atomic_writes.ts`.

### Phase 5 — Evolution-path e2e (THE acceptance gate)
- [ ] AC23 (THE big one): `tests/e2e/test_evolution_path.ts` runs the following 10-step script and asserts each assertion:
  1. **setup**: clean HOME; init git in `~/.claude/skila-data/`.
  2. **distill→draft**: `skila distill --from-fixture session-1.md` → produces draft `azure-pipeline-debug` v0.1.0 in `.draft-skila/` with `status: draft`; git log shows `distill: …` commit.
  3. **promote→published**: `skila promote azure-pipeline-debug` → status flips to `published`, file moves to `~/.claude/skills/azure-pipeline-debug/`.
  4. **distill→draft v0.2.0**: `skila distill --from-fixture session-2.md` (related) → judge proposes UPDATE→azure-pipeline-debug; draft v0.2.0 in `.draft-skila/` with `parentVersion: 0.1.0`.
  5. **auto-stage→`.staging-skila/`**: usage threshold met (≥10 invocations OR ≥1 failure); auto-promotion fires; file lands in `.staging-skila/azure-pipeline-debug/`, NOT in published. CC loader still skips because `.`-prefixed dir.
  6. **graduate→published**: `POST /api/skills/azure-pipeline-debug/graduate` (or `skila graduate azure-pipeline-debug`) → published v0.2.0; v0.1.0 retrievable via `skila inspect --version 0.1.0`.
  7. **feedback ×3**: `skila feedback azure-pipeline-debug --outcome success` ×3 → `feedback.json["azure-pipeline-debug"]` has `usageCount: 3, successRate: 1.0`, written under lock.
  8. **rollback**: `skila rollback azure-pipeline-debug --to 0.1.0` → v0.3.0 published (bytes-equal v0.1.0), revisionCount=3, changelog has "Rolled back to v0.1.0".
  9. **disable**: `skila disable azure-pipeline-debug` → status flips to `disabled`, file moves to `.disabled-skila/`. CC loader does not pick up.
  10. **reactivate**: `skila reactivate azure-pipeline-debug` → status back to `published`. Teardown asserts no orphan temp/lock files.

  Each step asserts file system state, git log state (or flat-file version dir state), and feedback.json state. Test runs under both git and flat adapters (matrix).

### Phase 6 — Quality bar dogfooding (carried from v1)
- [ ] AC24: skila itself ships as a real Anthropic-spec skill package: `skills/skila/SKILL.md` + `skills/skila/scripts/` (TS reimplementations of validate/lint/scan helpers, compiled to JS) + `skills/skila/references/` (skill-creator-schema, quality-bar, proposal-criteria) + `skills/skila/assets/` (templates, prompts).
- [ ] AC25: `skila lint skills/skila/` returns 0 warnings (skila passes its own quality bar).

## Assumptions Exposed & Resolved (v2)

| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| v1's Python+pure-skill substrate is acceptable | User explicitly rejected v1 as "糊弄 demo"; "我需要的是一个强力的 claude code 插件" | Discard Python entirely. TypeScript only. |
| Anthropic skill-creator + Hermes are sufficient design anchors | learner-deep-study revealed learner is a much closer baseline; v1 over-corrected toward Hermes formalism | Adopt learner as the baseline-to-beat; the 5 superiority dimensions in §8 of learner-deep-study are the v0.1 mandate. |
| `/skila` is the only surface | User: "我希望我们生成 skill 分 draft publish 之类的, 还有 update skill, 我们的 web 都可以管理起来" | Web is a *primary* control surface, not an optional viewer. CodeMirror in-browser editing is required. |
| Embedding model is needed for similarity | User chose: fold #4 into #5 | Pure LLM judge with tool-trace input replaces embedding index. Zero local model dependency. |
| Storage is plain files | User concern: git might intimidate users | git-backed default + automatic flat-file degradation. Users see identical web UI either way. |
| All produced skills are immediately usable | Learner does this — produces noise that pollutes user's skill library | Two-tier draft/published. Auto-promote gated on usage AND success metrics. |
| Web UI quality is "best effort" | User concern: "我有些担心你的 web 服务 ui 做的太丑" | Visual verdict gate (AC18) at ≥7/10. Reference: Obsidian/GitHub high-density workspace style. |
| npm name doesn't matter yet | User asked: "@yao/skila 被占用了吗" | Verified available; claimed. Distribution path is locked to `@yao/skila` + Claude plugin + Smithery. |

## Technical Context

### File tree (target end-state)
```
skila/
├── .claude-plugin/
│   └── plugin.json                    # slash + 2 hooks
├── docs/research/
│   ├── hermes-and-memex-study.md      # KEPT, append v2 Decision Update
│   └── learner-deep-study.md          # KEPT, design north star
├── scripts/
│   ├── postbuild.mjs                  # copy src/web/index.html → dist/web/
│   └── publish.mjs                    # release helper
├── server.json                        # MCP server manifest (smithery)
├── smithery.yaml                      # smithery deployment
├── package.json                       # @yao/skila, bin, engines
├── tsconfig.json
├── README.md                          # install + invoke + screenshots
├── LICENSE
├── src/
│   ├── cli.ts                         # `skila` command dispatcher
│   ├── commands/
│   │   ├── distill.ts                 # `/skila` invocation handler
│   │   ├── promote.ts
│   │   ├── archive.ts
│   │   ├── disable.ts
│   │   ├── reactivate.ts
│   │   ├── rollback.ts
│   │   ├── feedback.ts
│   │   ├── lint.ts
│   │   ├── serve.ts                   # web server entry
│   │   └── mcp.ts                     # MCP server (smithery)
│   ├── distill/
│   │   ├── extractor.ts               # session memory + tool trace → candidates
│   │   └── prompt.ts
│   ├── judge/
│   │   ├── judge.ts                   # LLM judge agent caller
│   │   └── prompt.ts                  # similarity + criteria + tool trace
│   ├── inventory/
│   │   ├── scanner.ts                 # walks ~/.claude/skills/, draft, archived, disabled
│   │   └── frontmatter.ts             # YAML parser (gray-matter or hand-rolled)
│   ├── validate/
│   │   ├── validate.ts                # BLOCKING schema validation
│   │   └── lint.ts                    # ADVISORY heuristics
│   ├── storage/
│   │   ├── index.ts                   # factory + adapter selection
│   │   ├── git.ts                     # GitBackedStorage
│   │   ├── flat.ts                    # FlatFileStorage
│   │   └── atomic.ts                  # atomic write helper (mv-rename)
│   ├── feedback/
│   │   ├── collector.ts               # PostToolUse + Stop hook handler
│   │   └── store.ts                   # ~/.claude/skila-data/feedback.json
│   ├── hooks/
│   │   └── feedback.cjs               # CJS bridge for plugin.json hooks
│   ├── web/
│   │   ├── server.ts                  # node:http server
│   │   ├── api/
│   │   │   ├── skills.ts
│   │   │   ├── versions.ts
│   │   │   ├── diff.ts
│   │   │   ├── feedback.ts
│   │   │   ├── promote.ts
│   │   │   └── ... (one file per endpoint group)
│   │   ├── index.html                 # single-file bundled UI
│   │   └── assets/                    # any static images
│   ├── config/
│   │   └── config.ts                  # ~/.claude/skila-data/config.json
│   └── types.ts                       # shared types
├── skills/
│   └── skila/                         # dogfooding: skila as a real skill
│       ├── SKILL.md
│       ├── scripts/
│       ├── references/
│       └── assets/
└── tests/
    ├── unit/
    │   ├── frontmatter.test.ts
    │   ├── validate.test.ts
    │   ├── lint.test.ts
    │   ├── scanner.test.ts
    │   ├── storage_atomic.test.ts
    │   └── feedback_store.test.ts
    ├── judge/
    │   ├── test_judge_prompt.ts
    │   └── test_extraction_uses_tool_trace.ts
    ├── web/
    │   ├── test_api_endpoints.ts
    │   └── test_editor_e2e.ts        # uses agent-browser
    ├── storage/
    │   ├── test_adapter_selection.ts
    │   └── test_atomic_writes.ts
    ├── e2e/
    │   ├── test_revise_path.ts
    │   ├── test_feedback_loop.ts
    │   ├── test_promotion_gate.ts
    │   ├── test_rollback.ts
    │   └── test_evolution_path.ts    # THE big e2e (AC23)
    └── fixtures/
        ├── session-1.md
        ├── session-2.md
        ├── session-related-azure.md
        └── skills/                    # fixture inventory
```

### Web UI ASCII layout reference (informs designer agent)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ skila  •  Dashboard │ Skills │ Settings        🟢 7 published  🟡 3 drafts   │
├──────────┬──────────────────────────────────────────────┬────────────────────┤
│ FILTER   │  azure-pipeline-debug                v0.3.0  │ VERSIONS           │
│ ☑ pub 7  │  ─────────────────────────────────────────── │ ▸ v0.3.0 (current) │
│ ☐ draft 3│  description: Pushy text about /azure...     │   v0.2.0  3d ago   │
│ ☐ arch 0 │                                              │   v0.1.0  5d ago   │
│ ☐ dis 0  │  [Edit SKILL.md] [Scripts ▸] [References ▸]  │                    │
│          │  ┌────────────────────────────────────────┐  │ FEEDBACK           │
│ SEARCH   │  │ # Skill Body                           │  │ Success rate ▁▃▆█  │
│ [_____]  │  │ ...                                    │  │   82%  (17 uses)   │
│          │  │ (CodeMirror 6 editor here)             │  │ Last used 2h ago   │
│ SKILLS   │  │                                        │  │                    │
│ ▸ azure… │  │                                        │  │ ACTIONS            │
│   pub    │  │                                        │  │ [Promote draft]    │
│ ▸ vip-…  │  │                                        │  │ [Rollback to v0.X] │
│   pub    │  │                                        │  │ [Disable]          │
│ ▸ deep…  │  │                                        │  │ [Archive]          │
│   draft  │  │                                        │  │                    │
│          │  └────────────────────────────────────────┘  │ DETAILS            │
│ + New    │  [Save] [Discard]            mtime: 2h ago   │ status: published  │
│          │                                              │ source: distill    │
└──────────┴──────────────────────────────────────────────┴────────────────────┘
```

### Reference projects
- **Memex** (`/Users/yao/work/code/awesome-project/memex`): substrate (TS+npm+plugin+smithery), serve.ts pattern, postbuild copy step.
- **Hermes** (`/Users/yao/work/code/awesome-project/hermes-agent`): SKILL.md schema + validation rules.
- **Learner** (`/Users/yao/work/code/awesome-project/oh-my-claudecode/src/hooks/learner`): the baseline-to-beat. Every superiority dimension maps to a documented learner gap (see `docs/research/learner-deep-study.md` §7).

## Ontology (final, 17 entities)

| Entity | Type | Key fields | Relationships |
|--------|------|-----------|---------------|
| Session | external | turns, in-context memory, tool trace | source for SkillProposal |
| User | actor | choices via web/CLI/AskUserQuestion | drives lifecycle ops |
| Skill | core | name, description, body, status, version | written to filesystem |
| ExistingSkill | core | name, description, status, path | matched by SkillProposal for UPDATE |
| SkillProposal | core | name, mode (NEW/UPDATE), targetName?, body, lines, complexity | unit of decision |
| UpdatePatch | core | targetSkill, parentVersion, newVersion, changelog | child of SkillProposal when mode=UPDATE |
| SkillScope | supporting | enum global/local | attribute of Skill on creation |
| SkillStatus | supporting | enum draft/published/archived/disabled | attribute of Skill |
| SkillVersion | core | name, version, body, parentVersion | history element |
| SkillVersionStorage | core | adapter (git or flat) | manages SkillVersion |
| StorageAdapter | core | interface (init, commit, list, get, diff) | implemented by GitBacked / Flat |
| InvocationFeedback | core | skillName, ts, outcome, session | drives auto-promotion + low-success flagging |
| FeedbackStore | core | feedback.json reads/writes | hook-collected |
| PromotionGate | core | thresholds (usageCount, successRate) | drives draft→published auto-promotion |
| JudgeAgent | external | LLM call with structured prompt | evaluates similarity + criteria + tool trace |
| HookRegistration | core | plugin.json hooks: PostToolUse + Stop | feedback collection only |
| WebController | core | node:http server, REST API, single-file UI | primary management surface |

## Interview Transcript Summary (v2)

| Round | Topic | Decision |
|-------|-------|----------|
| 1 | v0.1 scope (5 superiority dimensions) | All 5 mandatory |
| 2 | Embedding implementation | Fold #4 into #5 — pure LLM judge |
| 3 | Validation strategy | Evolution-path e2e test only |
| 4 | Draft/published gating (Contrarian) | Keep two-tier; promote via web/CLI/auto |
| 5 | Hook integration (Simplifier) | plugin.json declares hooks; zero config |
| 6 | Frontmatter schema | Hybrid: low-freq fields in frontmatter, high-freq feedback in skila-data/feedback.json |
| 7 | Web UI capability surface | Full editor (CodeMirror 6) + all lifecycle ops |
| 8 | Implementation language | TypeScript only; v1 Python discarded |
| 9 | Storage strategy | git-backed + auto-degrade to flat files |
| 10 (this) | UI design tonality | Obsidian/GitHub high-density workspace |
| 11 (this) | npm package name | `@yao/skila` (scope claimed) |

## Status & Next Steps

**Spec status**: PASSED (5.7% ambiguity, 17 ontology entities 100% stable, all 9 v2 rounds complete)

**Recommended next step (per user's note: "后续步骤我来决定")**: Stop here. User reviews spec. User chooses between:
- `/oh-my-claudecode:plan --consensus --direct .omc/specs/deep-interview-skila-v2.md` to refine the implementation plan via Planner/Architect/Critic.
- `/oh-my-claudecode:autopilot` to autonomously execute Phase 0 → Phase 6.
- `/oh-my-claudecode:ralph` to iterate Phase by Phase with reviewer verification.
- Manual implementation following this spec as the canonical contract.

This spec is the binding contract. Drift requires a Decision Update appended to `docs/research/hermes-and-memex-study.md`.
