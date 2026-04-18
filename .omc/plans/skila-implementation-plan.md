# skila — Implementation Plan

- Plan ID: skila-impl-2026-04-18
- Iteration: 3 (post Architect + Critic polish)
- Spec: `/Users/yao/work/code/personal/skila/.omc/specs/deep-interview-skila-distill.md`
- Project root: `/Users/yao/work/code/personal/skila/`
- Status: Ready for execution (gated by Phase 0 research)

---

## 1. Requirements Summary (cited from spec)

| # | Requirement | Spec lines |
|---|---|---|
| R1 | Build a Claude Code plugin invoked via `/skila` slash command that distills the agent's in-context conversation memory into 0/1/N production-ready Anthropic-spec skill packages (SKILL.md + scripts/ + references/ + assets/). | 21–25 |
| R2 | Quality bar: NEVER produce "garbage skills". Deterministic procedures → `scripts/`; domain knowledge → `references/`; standardized output → `assets/`. SKILL.md follows skill-creator schema; description "pushy"; body ≤500 lines. Hermes is design north star. | 27–38 |
| R3 | Trigger ONLY via `/skila` (no Stop hook). Source = live in-context memory; do NOT read JSONL transcripts. | 42–43 |
| R4 | Per-proposal scope choice: `~/.claude/skills/<name>/` (global) vs `<repo>/.claude/skills/<name>/` (project-local). Scope is **baked into the proposal row variant** (see R14) — no separate scope question. | 44 |
| R5 | YAML frontmatter (`name`, `description`, optional `argument-hint`); markdown body. | 45 |
| R6 | Similarity = pure LLM judgment over inventory `(name, description)` pairs. NO embeddings/tags/vectors. | 46 |
| R7 | Quality criteria (any one): complex success / reusable workflow / user correction-or-preference. | 47–50 |
| R8 | Empty result is a first-class outcome — print explicit "no skill worth crystallizing". | 51 |
| R9 | Plugin shape modeled on memex: `.claude-plugin/plugin.json` + `skills/skila/SKILL.md`; no required MCP server in v1. | 52 |
| R10 | **R-DOC-1 hard gate**: `docs/research/hermes-and-memex-study.md` must be written and committed BEFORE any code in `skills/`, `src/`, `.claude-plugin/`. | 56–58, 73 |
| R11 | R-DOC-2: research doc enumerates borrow / diverge / why for each insight. | 59 |
| R12 | R-DOC-3: every implementation commit cites the relevant research-doc section; deviations append a "Decision Update". | 60 |
| R13 | UI (Iteration-2 collapse): **Wave 1** — single multi-select `AskUserQuestion` whose row variants encode scope and intent (`[NEW@global]`, `[NEW@local]`, `[UPDATE→X]`); **Wave 2** — per-accepted-`[UPDATE]` follow-up `AskUserQuestion` with `[Apply patch]` / `[Skip]` / `[Show full new version]` and an inline diff. No third wave. | 87–89 |
| R14 | Per-row format (Iteration-2): `[NEW@global] <name> — <description> (~<lines> lines, <complexity>)` / `[NEW@local] <name> — <description> (~<lines> lines, <complexity>)` / `[UPDATE→<existing-name>] <name> — <description> (~<lines> lines, <complexity>)`. Scope is encoded in the variant tag; the agent emits two rows for `[NEW]` candidates when both scopes are plausible and lets the user pick at most one. | 87–88 |
| R15 | Atomic writes via Bash `mv` of a sibling temp file on the same filesystem (POSIX-atomic rename); no separate `atomic_write.py`. | 91 |
| R16 | End-of-run summary: `N created, M updated, K skipped, L discarded` — emitted directly by SKILL.md plan-text (no `summary.py` helper). | 92 |
| R17 | Skill quality lint = **advisory only**. `lint_skill.py` always exits 0; warnings are printed inline next to the proposal row but never block writes. | 82 |
| R18 | Generated SKILL.md validation = **blocking**. `validate_skill.py` exits non-zero ⇒ skila refuses to write that proposal; the user sees the error and can fix or discard. | 93 |
| R19 | Non-goals: no transcript reading, no Stop-hook auto-trigger, no embeddings, no cross-machine sync, no runtime skill engine, no edits outside `~/.claude/skills/` and `<repo>/.claude/skills/`. | 64–69 |

---

## 2. RALPLAN-DR — Pure-Skill vs CLI Decision

### Principles (5)
1. **Spec fidelity over framework flex** — the spec (line 109) explicitly leaves runtime open and asks ralplan to resolve. Optimize for the simplest layer that satisfies all acceptance criteria.
2. **Determinism where it matters** — frontmatter validation is correctness-critical and benefits from deterministic code; file-rename atomicity is a property of POSIX rename, not of a helper script.
3. **Agent-leverage where it matters** — distillation, similarity judgment, content authoring are LLM-native and resist codification.
4. **Anti-drift via reference projects** — closest viable reference wins; spec names hermes (Python) and memex (TypeScript) as anchors.
5. **Lowest install/maintenance friction** — CC plugin should just work after `claude plugin install`; no compile step is a feature, not a bug.

### Top 3 Decision Drivers
1. **Correctness of file-system writes** (POSIX `mv` is already atomic on same-fs; no helper needed) — R15, R19.
2. **Validation determinism** — R18 demands a hard, scriptable frontmatter check; R17 lint stays advisory-only and is therefore allowed to live as a heuristic Python helper.
3. **Install/portability surface** — pure markdown plugin = zero runtime deps; CLI = node/python toolchain in user env.

### Viable Options

#### Option A — Pure-Skill (markdown only; agent does all work via SKILL.md)
- **Shape**: `.claude-plugin/plugin.json` + `skills/skila/SKILL.md` + `skills/skila/references/*.md` (the skill-creator schema, lint rules, atomic-write recipe as bash one-liners executed via the agent's Bash tool).
- **Pros**: zero install footprint; mirrors Anthropic's `skill-creator`; no build/CI; iterating prompts is a doc edit.
- **Cons**: blocking frontmatter validation expressed as prose is brittle (R18); inventory scan in pure prose is fragile across hosts; harder to unit-test.

#### Option B — Hybrid: pure-skill + thin scripts/ (no compiled CLI)  ★ chosen
- **Shape**: Option A plus `skills/skila/scripts/` containing exactly **three** stdlib-only Python helpers:
  - `validate_skill.py` (BLOCKING — gates writes per R18)
  - `scan_inventory.py` (deterministic FS walk + frontmatter parse)
  - `lint_skill.py` (ADVISORY — heuristic warnings per R17)
- All other "scriptable" needs are inlined into SKILL.md plan-text:
  - **Atomic write** → `python3 -c '...write to <name>.tmp...' && mv <name>.tmp <name>` (POSIX rename is atomic on same filesystem; no helper).
  - **Diff rendering** → `diff -u <old> <new>` directly in the AskUserQuestion follow-up step.
  - **End-of-run summary** → SKILL.md tells the agent to print `N created, M updated, K skipped, L discarded` from its own counters.
- **Pros**: determinism for the two correctness-critical ops (validate, scan); no package manager, no compile, no `pip`; the three scripts each carry meaningful logic (frontmatter parser, FS walker, heuristic linter); skila eats its own dogfood (`scripts/` reserved for non-trivial logic).
- **Cons**: still two surfaces (markdown + 3 scripts), but the surface is minimized to the smallest defensible set.

##### Scripts shrink — rationale (Critic-driven, Iteration 2)
Iteration 1 listed six helper scripts (`scan_inventory.py`, `validate_skill.py`, `lint_skill.py`, `atomic_write.py`, `render_diff.sh`, `summary.py`). The Critic correctly flagged that three of those were thin wrappers over POSIX/Bash idioms with no algorithmic content:

- `atomic_write.py` re-implemented `os.replace` over `mv`; on the same filesystem `mv` is already POSIX-atomic, so a wrapper adds maintenance surface without adding a property. SKILL.md now instructs the agent to write to a sibling `<name>.tmp` then `mv` it into place.
- `render_diff.sh` was a one-line wrapper over `diff -u`. SKILL.md now invokes `diff -u` inline during the Wave-2 follow-up.
- `summary.py` was string formatting over four integers the agent already tracks. SKILL.md prints the summary line directly.

Keeping only `validate_skill.py`, `scan_inventory.py`, and `lint_skill.py` honors the spec's own quality bar — `scripts/` is for **deterministic procedures whose logic exceeds shell-idiom**, not for ceremonial wrappers. AC16 (added Iteration 2) makes this rule mechanical: every file in `scripts/` must contain >10 lines of substantive code.

#### Option C — Full TypeScript CLI (memex-style npm package)
- **Pros**: strongest determinism, full type safety, vitest unit tests; closest to memex.
- **Cons**: requires `node` ≥18 + `npm install`/build in user env; release pipeline overkill for v1; biggest blast radius. None of its incremental wins are required by acceptance criteria.

### Recommendation: **Option B (Hybrid, 3-script edition)**

**Rationale**: Option B uniquely satisfies the top decision drivers without the install-cost penalty of Option C, and — after the Iteration-2 shrink — without the maintenance penalty of Iteration-1's six-script footprint. Option A is rejected because R18 (blocking validation) cannot be reliably met by prompt discipline alone. Option C is rejected for v1 because it imposes a `node` runtime + build step that spec line 109 explicitly leaves optional. If Phase 0 reveals memex's TypeScript machinery is essential (e.g., AskUserQuestion requires TS), Option C remains the documented fallback; that pivot would land as a "Decision Update" per R-DOC-3.

---

## 3. Phased Implementation Steps

### Phase 0 — Research (HARD GATE per R-DOC-1)
**No file under `skills/`, `src/`, or `.claude-plugin/` may be created in this phase.**

Deliverable: `/Users/yao/work/code/personal/skila/docs/research/hermes-and-memex-study.md`

Required sections:
1. **Hermes-agent study** — read-only analysis of:
   - `/Users/yao/work/code/awesome-project/hermes-agent/tools/skill_manager_tool.py` (skill induction, create/update/patch semantics, naming rules, security scanning, validation).
   - `/Users/yao/work/code/awesome-project/hermes-agent/skills/` directory shape.
2. **Memex study** — read-only analysis of:
   - `/Users/yao/work/code/awesome-project/memex/skills/memex-retro/SKILL.md` (distillation prompt shape).
   - `/Users/yao/work/code/awesome-project/memex/.claude-plugin/plugin.json` (manifest schema).
   - `/Users/yao/work/code/awesome-project/memex/src/commands/write.ts` and `src/lib/store.ts` (atomic-write + dedup patterns).
   - `/Users/yao/work/code/awesome-project/memex/hooks/` (Stop hook pattern — referenced for divergence only since skila uses slash trigger).
3. **Borrow / Diverge / Why** matrix per insight (R-DOC-2). Every entry MUST include a source-line anchor (e.g., `tools/skill_manager_tool.py:211-226`).
4. **Open Questions / Decision Updates** (initially empty; future commits append per R-DOC-3).
5. **Decision Record**: pin Option B (3-script edition) from §2 and link rationale.

Exit criteria (Iteration-2 — coverage-based, replaces the old "≥600 lines" floor):
- Every file path enumerated in the Phase 0 file list above is cited at least once in the doc.
- Every borrow/diverge entry includes a source-line anchor (`<relative/path>:<start>-<end>`).
- Committed to git on `main` (or feature branch) with message referencing R-DOC-1.
- `git log --name-only` shows zero changes outside `docs/research/`.

### Phase 1 — Plugin Skeleton
Files to create:
- `.claude-plugin/plugin.json` — minimal manifest: `{"name":"skila","version":"0.1.0","description":"Distill in-context session memory into production-ready Anthropic-spec skill packages","license":"MIT"}`. (Cite memex manifest from research doc §2.)
- `skills/skila/SKILL.md` — frontmatter (`name: skila`, pushy description with explicit `/skila` trigger cue, `argument-hint` optional) + body shell (overview, when to invoke, references to bundled scripts, ≤500 lines target).
- `README.md` update — install + usage snippet (1 paragraph).

Each commit message cites the research-doc section that justifies the choice (R-DOC-3).

### Phase 2 — Deterministic Helper Scripts (Option B core, 3-script edition)
Files to create under `skills/skila/scripts/` — **and ONLY these three**:
- `scan_inventory.py` — walk `~/.claude/skills/` and `<cwd>/.claude/skills/`, parse YAML frontmatter, emit JSON list of `{name, description, scope, path}`. Stdlib-only (no PyYAML; tiny frontmatter splitter). Distinguishes "absent dir" from "empty dir".
- `validate_skill.py` — **BLOCKING**. Given a SKILL.md path: assert frontmatter parses, `name` matches parent dir, `description` ≤ 1024 chars, body ≤ 500 lines. Exit non-zero on failure with structured stderr; SKILL.md plan-text guarantees skila refuses to write a proposal whose validate exits non-zero.
- `lint_skill.py` — **ADVISORY**. Implements R17 heuristics (verbs like "fetch/run/scan/grep/build" in description + absence of `scripts/` sibling dir). Always exits 0; emits `WARN`/`PASS` JSON to stdout. SKILL.md surfaces warnings inline in the Wave-1 row but never blocks the write.

Files to create under `skills/skila/references/` — agent-read domain knowledge per Anthropic spec:
- `skill-creator-schema.md` — exact frontmatter rules cited in spec lines 34–37.
- `quality-bar.md` — codifies spec lines 27–38 (deterministic→scripts, knowledge→references, output→assets).
- `proposal-criteria.md` — spec lines 47–50 (the three quality criteria).

Files to create under `skills/skila/assets/` — standardized outputs the agent emits:
- `SKILL.md.tmpl` — empty Anthropic-spec skill scaffold the agent fills in.
- `proposal-row.tmpl` — exact row-variant strings from R14 (`[NEW@global]`, `[NEW@local]`, `[UPDATE→X]`).
- `prompts/prompt-templates.md` — exact prompt skeletons for distillation, similarity judgment, and update-patch generation. (Moved from `references/` in Iteration 2: prompts are *agent-emitted assets*, not domain knowledge the agent reads to learn.)

### Phase 3 — Wire SKILL.md to the workflow (2-wave UI)
Update `skills/skila/SKILL.md` body (still ≤500 lines) to a hierarchical, imperative procedure:
1. **Trigger gate** — only run when invoked via `/skila`.
2. **Distill from in-context memory** — explicit prompt block referencing `references/proposal-criteria.md`. Forbid reading `~/.claude/projects/` (R19).
3. **Inventory scan** — `python3 scripts/scan_inventory.py`.
4. **LLM proposal pass** — feed inventory list + distilled candidates; emit rows using `assets/proposal-row.tmpl`. For each `[NEW]` candidate where both scopes are plausible, emit two rows (`[NEW@global]` and `[NEW@local]`); for an obvious-scope candidate, emit one. Run `lint_skill.py` per draft and append `(WARN: <reason>)` inline next to the row when applicable. **Row-count cap**: soft cap of 8 rows in Wave-1; if more candidates would result, collapse low-confidence ones into a single `[+N more low-confidence candidates omitted]` summary row, and for ambiguous-scope `[NEW]` candidates emit only the more-likely scope when total row count would exceed 8.
5. **Empty-result branch** — if N=0, print spec line 51's exact verbiage and exit (R8).
6. **Wave 1 — single multi-select `AskUserQuestion`** — listing all candidate rows; user multi-selects. Scope is encoded in the row variant; **no separate scope question** (Iteration-2 collapse).
7. **Wave 2 — per-accepted-`[UPDATE]` follow-up** — for each accepted `[UPDATE→X]`, render diff via inline `diff -u <old> <new>`, present three-option `AskUserQuestion`: `[Apply patch]` / `[Skip]` / `[Show full new version]`.
8. **Validate (BLOCKING)** — `python3 scripts/validate_skill.py <draft>`; on non-zero exit, refuse the write for that proposal, surface the stderr to the user, continue with remaining proposals.
9. **Atomic write (inline)** — write content to `<dest>.tmp` next to `<dest>` on the same filesystem, then `mv <dest>.tmp <dest>` (POSIX-atomic rename); no helper script.
10. **Summary** — print `N created, M updated, K skipped, L discarded` directly (R16).

### Phase 4 — Self-Tests (scriptable; Iteration-2 promotes manual ACs)
A new `--dry-run` mode is added to skila (implemented as a documented SKILL.md branch + a minimal `scripts/skila_dryrun.py` shim that emits the same JSON the SKILL.md would pass to `AskUserQuestion`). Dry-run consumes a fixture session-memory markdown file and prints the AskUserQuestion JSON it *would* emit, without actually invoking the tool. This makes AC6/7/9/10/11/13 scriptable.

> **Dry-run JSON contract (scope of coverage)**: the `tests/bin/skila_dryrun.py` shim parses fixture markdown and emits canned AskUserQuestion JSON per a deterministic mapping table; it does NOT invoke the LLM, so it tests JSON-shape contracts only — distillation quality is NOT covered by dry-run.

> Note: the dry-run shim is not a skila helper script in the sense of §2 — it is a test-only fixture runner under `tests/` (or, if colocated, explicitly excluded from AC16 by being placed at `tests/bin/skila_dryrun.py`).

Files to create under `tests/`:
- `tests/fixtures/skills/` — sample existing-skill dirs, sample malformed SKILL.md, sample "garbage" prose-only skill.
- `tests/fixtures/session-empty.md` — empty/no-signal session fixture (drives AC7).
- `tests/fixtures/session-single-new.md` — session that should propose exactly one `[NEW]`.
- `tests/fixtures/session-update.md` — session that should propose one `[UPDATE→X]` against a fixture inventory.
- `tests/fixtures/session-multi.md` — session producing N>1 mixed proposals (drives AC9, AC11).
- `tests/fixtures/session-garbage.md` — drives lint WARN inline (AC5).
- `tests/fixtures/expected/wave1.json` — expected Wave-1 AskUserQuestion JSON for `session-multi.md` (drives AC6/9/11 contract assertions).
- `tests/fixtures/expected/wave2.json` — expected Wave-2 AskUserQuestion JSON for `session-update.md` after a simulated Wave-1 acceptance (drives AC10).
- `tests/fixtures/README.md` — enumerates which AC each fixture drives; marks tested boundary as "JSON shape contracts tested; LLM judgment quality NOT tested"; requires `session-multi.md` and `session-update.md` to be transcribed from real Phase 0 dogfooding sessions, not synthetic.
- `tests/test_validate.sh` — shell runner asserting `validate_skill.py` exit codes against fixtures (AC4).
- `tests/test_lint.sh` — same for `lint_skill.py`; asserts exit code is always 0 and JSON `WARN` payload is correct (AC5).
- `tests/test_scan.sh` — point at fixture skills dir, diff JSON output against expected (AC8).
- `tests/test_dryrun_empty.sh` — runs skila dry-run on `session-empty.md`; asserts output is the spec-line-51 verbiage (AC7).
- `tests/test_dryrun_wave1.sh` — runs skila dry-run on `session-multi.md`; asserts the emitted Wave-1 AskUserQuestion JSON contains the expected `[NEW@global]` / `[NEW@local]` / `[UPDATE→X]` row variants (AC6, AC9, AC11).
- `tests/test_dryrun_wave2.sh` — runs skila dry-run on `session-update.md` with a simulated Wave-1 acceptance; asserts the Wave-2 AskUserQuestion JSON has `[Apply patch]` / `[Skip]` / `[Show full new version]` and an inline diff body (AC10).
- `tests/test_dryrun_summary.sh` — asserts the printed summary line matches `\d+ created, \d+ updated, \d+ skipped, \d+ discarded` (AC13).
- `tests/test_atomic_rename.sh` — drives the SKILL.md inline write recipe against a tmpdir; asserts the tmp file is gone on success and the destination is byte-identical to source (AC12).
- `tests/test_scripts_shrink.sh` — enforces AC16: lists every file in `skills/skila/scripts/`, asserts each has >10 lines of substantive (non-blank, non-comment) code; fails if a 4th script appears. Header documents the LOC algorithm: **substantive LOC = total - lines matching `^\s*$` (blank) or `^\s*#` (full-line comment).**
- `tests/run_all.sh` — orchestrator returning non-zero if any sub-test fails.

### Phase 5 — Documentation & Release
- Update `README.md` with: install via `claude plugin install`, `/skila` invocation, screenshots/example transcript.
- `docs/research/hermes-and-memex-study.md` → append "Decision Update — Phase 5 lessons" if any divergence accumulated (R-DOC-3).
- Tag `v0.1.0`.

---

## 4. Acceptance Criteria (mirrors spec, scriptable-first)

| # | Criterion | Test | Scriptable? |
|---|---|---|---|
| AC1 | R-DOC-1 file exists and is committed before any code in `skills/`, `src/`, `.claude-plugin/`. | `git log --diff-filter=A --name-only` ordering check. | yes |
| AC2 | Research doc enumerates borrow/diverge/why for both projects with source-line anchors; every Phase-0 path is cited. | `tests/test_research_coverage.sh` greps the doc for each enumerated path + anchor regex. | yes |
| AC3 | Each generated skill is a directory with at least SKILL.md; scripts/ when description implies determinism; references/ when domain knowledge involved; assets/ when standardized output. | `tests/test_lint.sh` over fixture proposals. | yes |
| AC4 | SKILL.md frontmatter parses, `name` matches dir, description ≤1024 chars, body ≤500 lines. **Validation is BLOCKING — non-zero exit ⇒ no write.** | `tests/test_validate.sh`. | yes |
| AC5 | Lint pass surfaces warnings (advisory, never blocks) for prose-only skills whose description implies executable behavior. **`lint_skill.py` always exits 0**; warnings appear inline next to the proposal row. | `tests/test_lint.sh` fixture `prose-only-fetch-logs/` — assert exit=0 and JSON `status:"WARN"`. | yes |
| AC6 | `/skila` triggers a single proposal pass over current context. | `tests/test_dryrun_wave1.sh` asserts exactly one Wave-1 JSON payload is emitted. | yes |
| AC7 | Empty session prints clear "no proposals" exit. | `tests/test_dryrun_empty.sh`. | yes |
| AC8 | Inventory scan covers `~/.claude/skills/` and `<cwd>/.claude/skills/`. | `tests/test_scan.sh`. | yes |
| AC9 | Candidates appear in single multi-select `AskUserQuestion` using R14 row variants (`[NEW@global]` / `[NEW@local]` / `[UPDATE→X]`). | `tests/test_dryrun_wave1.sh` asserts JSON `options[*].label` matches the variant regexes. | yes |
| AC10 | Each accepted `[UPDATE]` gets a per-candidate `AskUserQuestion` with Apply / Skip / Show + inline `diff -u` body. | `tests/test_dryrun_wave2.sh`. | yes |
| AC11 | Scope choice is baked into Wave-1 row variants — no standalone scope question is emitted. | `tests/test_dryrun_wave1.sh` asserts the JSON contains zero AskUserQuestion payload whose label set equals `{global, local}`. | yes |
| AC12 | All writes are atomic (POSIX rename of sibling tmp file on same fs); existing SKILL.md is never partially overwritten on failure. | `tests/test_atomic_rename.sh`. | yes |
| AC13 | End-of-run summary printed in spec format. | `tests/test_dryrun_summary.sh`. | yes |
| AC14 | No reads of `~/.claude/projects/`. | Static grep over scripts + SKILL.md for that path → must be absent. | yes |
| AC15 | No writes outside `~/.claude/skills/` or `<cwd>/.claude/skills/`. | Static grep over scripts + SKILL.md for write targets. | yes |
| AC16 | `skills/skila/scripts/` contains only files whose logic exceeds 10 lines of substantive code (no shell-idiom wrappers). Exactly three files: `validate_skill.py`, `scan_inventory.py`, `lint_skill.py`. | `tests/test_scripts_shrink.sh`. | yes |

**Scriptable coverage**: 16/16 = 100% (Iteration-2 target was ≥90%).

---

## 5. Risks + Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Agent skips validate step ("forgets" to run it). | Med | High (broken skills written). | SKILL.md makes validate a numbered, non-skippable step; `validate_skill.py` is BLOCKING — non-zero exit ⇒ skila refuses the write for that proposal, surfaces stderr, continues with the rest. Fixture-tested. |
| Inventory scan returns empty due to symlinks/missing dirs and silently passes. | Low | Med | `scan_inventory.py` distinguishes "absent" vs "empty" and logs both; tested via fixtures. |
| LLM hallucinates `[UPDATE → X]` against a name that doesn't exist. | Med | Med | Pre-render check: each proposed `[UPDATE→X]` must appear in scan_inventory output; otherwise downgrade to `[NEW@global]` / `[NEW@local]` with an inline note. |
| Atomic rename race condition (concurrent `/skila` runs). | Low | Med | POSIX `mv` of same-fs sibling tmp file is atomic; SKILL.md plan-text mandates the tmp file live next to the destination, never in `/tmp`. Optional advisory `flock` documented in SKILL.md for power users. |
| Spec drift mid-implementation (scope creep into Stop-hook auto-trigger). | Med | High | Append "Decision Update" to research doc per R-DOC-3 — forces explicit acknowledgement. |
| Python 3 unavailable on user host. | Low | Med | Document `python3` ≥3.9 as a stated prereq in README; scripts use stdlib only so no `pip` step. |
| Pure-skill purists object to scripts/. | Low | Low | Documented in §2 "Scripts shrink — rationale"; AC16 mechanically enforces the 3-script floor and >10-LOC substance bar. |
| Lint heuristic produces false positives. | Med | Low | `lint_skill.py` is **advisory only — always exits 0**; warnings surface inline next to the proposal row in Wave 1; user is free to accept anyway. Never blocks a write. |
| User picks wrong scope variant and clobbers a homonymous global skill. | Low | High | Wave-1 row variant always shows the resolved destination path (`~/.claude/skills/<name>/SKILL.md` vs `<cwd>/.claude/skills/<name>/SKILL.md`); SKILL.md mandates a `.bak` copy of any pre-existing SKILL.md before the rename. |
| Python 3 version drift in CI matrix. | Low | Med | Pin `python3 >= 3.9` in `plugin.json` `compatibility` field and assert in `validate_skill.py` via `sys.version_info >= (3,9)`; CI matrix tests against 3.9 / 3.11 / 3.12. |

---

## 6. Verification Steps

1. **Phase 0 gate check** — after research-doc commit, run `git log --diff-filter=A --name-only` and confirm zero entries under `skills/`, `src/`, or `.claude-plugin/` precede the doc.
2. **Static checks per phase** — after each phase, `tests/run_all.sh` must pass.
3. **Scriptable end-to-end via dry-run** — `tests/test_dryrun_*.sh` cover Wave-1 emission, Wave-2 emission, empty session, and summary line. No human-in-the-loop required for AC verification.
4. **Spec-trace audit** — for each row in the §1 requirements table, point at the file/line in the implementation that satisfies it. Append to research doc as a "Trace Matrix".
5. **Independent code review** — delegate to `code-reviewer` agent (separate context per OMC verification protocol) for a final sign-off.

---

## File Tree After All Phases

```
skila/
├── .claude-plugin/
│   └── plugin.json
├── docs/
│   └── research/
│       └── hermes-and-memex-study.md          # Phase 0 — HARD GATE
├── skills/
│   └── skila/
│       ├── SKILL.md
│       ├── scripts/                            # exactly 3 files (AC16)
│       │   ├── validate_skill.py               # BLOCKING
│       │   ├── scan_inventory.py
│       │   └── lint_skill.py                   # ADVISORY (always exit 0)
│       ├── references/                         # agent-read domain knowledge
│       │   ├── skill-creator-schema.md
│       │   ├── quality-bar.md
│       │   └── proposal-criteria.md
│       └── assets/                             # agent-emitted standardized outputs
│           ├── SKILL.md.tmpl
│           ├── proposal-row.tmpl
│           └── prompts/
│               └── prompt-templates.md
├── tests/
│   ├── bin/
│   │   └── skila_dryrun.py                     # test-only; excluded from AC16
│   ├── fixtures/
│   │   ├── README.md
│   │   ├── expected/
│   │   │   ├── wave1.json
│   │   │   └── wave2.json
│   │   ├── skills/
│   │   ├── session-empty.md
│   │   ├── session-single-new.md
│   │   ├── session-update.md
│   │   ├── session-multi.md
│   │   └── session-garbage.md
│   ├── test_validate.sh
│   ├── test_lint.sh
│   ├── test_scan.sh
│   ├── test_dryrun_empty.sh
│   ├── test_dryrun_wave1.sh
│   ├── test_dryrun_wave2.sh
│   ├── test_dryrun_summary.sh
│   ├── test_atomic_rename.sh
│   ├── test_scripts_shrink.sh
│   ├── test_research_coverage.sh
│   └── run_all.sh
├── README.md
└── LICENSE
```

---

## Changelog — Iteration 2

- **scripts/ shrunk from 6 → 3 files** (`validate_skill.py`, `scan_inventory.py`, `lint_skill.py`); `atomic_write.py`, `render_diff.sh`, `summary.py` deleted. SKILL.md now uses Bash `mv` (POSIX-atomic same-fs rename), inline `diff -u`, and direct summary printing. New AC16 + `tests/test_scripts_shrink.sh` mechanically enforce the floor.
- **Lint posture contradiction resolved**: `validate_skill.py` is **BLOCKING** (R18, AC4) and refuses writes on non-zero exit; `lint_skill.py` is **ADVISORY** (R17, AC5), always exits 0, warnings surface inline next to Wave-1 rows. Risk #1 and Risk #8 rewritten to agree.
- **`prompt-templates.md` moved** from `references/` to `assets/prompts/` — prompts are agent-emitted standardized outputs, not domain knowledge the agent reads to learn.
- **Phase 3 UI collapsed from 3 waves → 2**: Wave-1 single multi-select with row variants (`[NEW@global]`, `[NEW@local]`, `[UPDATE→X]`) bakes scope into the row; Wave-2 per-`[UPDATE]` follow-up unchanged. Standalone scope-choice step deleted. R14 row template updated; AC11 rewritten to assert no standalone scope question is emitted.
- **Phase 0 exit criterion replaced**: the "≥600 lines of substantive analysis" floor is gone; replaced with coverage criteria — every enumerated Phase-0 file path is cited at least once and every borrow/diverge entry carries a source-line anchor. New `tests/test_research_coverage.sh` makes this scriptable (AC2).
- **Manual ACs promoted to scriptable**: AC6/7/9/10/11/13 are now driven by a `--dry-run` mode (test-only `tests/bin/skila_dryrun.py`) that emits the AskUserQuestion JSON without invoking the tool. New session-memory fixtures + `tests/test_dryrun_*.sh` lift scriptable coverage to **16/16 = 100%** (target was ≥90%).

---

## ADR — Architectural Decision Record

### Decision
Adopt **Option B (Hybrid pure-skill + 3 stdlib scripts)** as the runtime substrate for skila, with **research-doc-first ordering** (R-DOC-1 hard gate before any code), a **validate-blocking / lint-advisory split** (correctness gates writes; quality heuristics never block), a **2-wave AskUserQuestion UI** (Wave-1 multi-select with scope baked into row variants, Wave-2 per-`[UPDATE]` follow-up), and **scope-in-row encoding** (`[NEW@global]` / `[NEW@local]` / `[UPDATE→X]`) that eliminates a standalone scope question.

### Decision Drivers
1. **Correctness of file-system writes** — POSIX `mv` of a same-filesystem sibling tmp is already atomic; no helper script can improve on it (R15, R19).
2. **Validation determinism** — R18 demands a hard, scriptable frontmatter check that gates writes; this cannot be reliably expressed as prompt prose.
3. **Install/portability surface** — a CC plugin should "just work" after `claude plugin install`; every additional runtime (node, npm, build step) widens the blast radius and is unjustified by acceptance criteria.

### Alternatives Considered
- **Option A (pure-skill markdown only)** — steel-manned by Architect as the lowest-friction path; rejected because R18 (BLOCKING validation) cannot be reliably enforced by prompt discipline, and inventory-scan in pure prose is fragile across hosts.
- **Option C (full TypeScript CLI like memex)** — strongest determinism and testing story; rejected for v1 due to substrate mismatch (CC skills are markdown-first), build cost (node ≥18 + npm install + release pipeline), and absence of any acceptance criterion that requires it.

### Why Chosen
- Option B is the **only** option that satisfies all three top decision drivers simultaneously: it gives deterministic validation (driver 2) without imposing a node toolchain (driver 3), while leaning on POSIX rename for atomicity (driver 1).
- The 3-script floor (`validate_skill.py`, `scan_inventory.py`, `lint_skill.py`) is the smallest defensible set — each script carries algorithmic logic that exceeds shell-idiom (AC16 mechanically enforces this).
- Research-doc-first ordering (R-DOC-1) imports proven patterns from hermes/memex before any code is written, anchoring divergences explicitly.

### Consequences
- **Positive**:
  - Zero install footprint beyond `python3 ≥ 3.9` (already a CC prereq); no `npm`, no compile step, no release pipeline for v1.
  - 16/16 acceptance criteria are scriptable; CI can verify the full contract without human-in-the-loop.
- **Negative**:
  - Must accept an **agent-discipline dependency**: distillation quality, similarity judgment, and proposal authoring all live in prompts that no script can verify; only dogfooding catches regressions.
  - Must **dogfood the quality bar** — `session-multi.md` / `session-update.md` fixtures must be transcribed from real Phase 0 sessions, not synthesized, or the test suite gives false confidence.

### Follow-ups
- v2: embedding-based similarity (deferred per spec Non-Goal R19).
- v2: Stop-hook auto-trigger (deferred per spec Non-Goal R19).
- Post-launch: collect dogfooding fixtures to harden `tests/fixtures/` against regressions in distillation prompt edits.

---

## Changelog — Iteration 3 (Polish)

- **Dry-run JSON contract specified** (Architect #1 + Critic #1): Phase 4 now states explicitly that `tests/bin/skila_dryrun.py` tests JSON-shape contracts only, not LLM judgment quality. New expected fixtures `tests/fixtures/expected/wave1.json` and `tests/fixtures/expected/wave2.json` added to the file list and the file tree.
- **Row-count soft cap added** (Architect #2 + Critic #2): Phase 3 step 4 now caps Wave-1 at 8 rows, collapsing low-confidence overflow into a `[+N more low-confidence candidates omitted]` summary row and emitting only the more-likely scope for ambiguous `[NEW]` candidates when the cap would be exceeded.
- **Fixture realism + provenance enforced** (Architect #3 + Critic #3): `tests/fixtures/README.md` added to the file list and tree; required to enumerate per-AC coverage, mark the JSON-shape-only boundary, and require `session-multi.md` / `session-update.md` to be transcribed from real Phase 0 dogfooding sessions, not synthetic.
- **AC16 LOC algorithm specified** (Critic #4): `test_scripts_shrink.sh` header now documents the rule `substantive LOC = total - lines matching ^\s*$ or ^\s*#`.
- **Risk #11 added** (Critic #5): Python 3 version drift mitigated by pinning `python3 >= 3.9` in `plugin.json` `compatibility` and asserting `sys.version_info >= (3,9)` inside `validate_skill.py`; CI matrix tests 3.9 / 3.11 / 3.12.
- **ADR appended** consolidating Option B rationale, alternatives (A steel-manned, C rejected), consequences (must accept agent-discipline dependency + must dogfood), and v2 follow-ups.
