# skila v2 Implementation Plan (deliberate mode) — Iteration 2

> Source spec: `/Users/yao/work/code/personal/skila/.omc/specs/deep-interview-skila-v2.md`
> Mode: **deliberate** (RALPLAN-DR + pre-mortem + expanded test plan)
> Generated: 2026-04-19 (Iteration 1) → revised 2026-04-19 (Iteration 2 after Architect REVISE-REQUIRED + Critic REJECT)
> Status: ready for executor handoff after Phase 0 commit lands

---

## 1. Requirements Summary

The spec defines 25 acceptance criteria spanning 7 phases. Line ranges below refer to `deep-interview-skila-v2.md`.

### Phase 0 — Research-first hard gate (spec L179–183)
- **AC1** (L180): `hermes-and-memex-study.md` gains "Decision Update — v2" with **6** Borrow/Diverge entries (TS substrate, web panel, npm distribution, feedback hooks, **build-time vendor (no CDN)**, **staging-tier auto-promotion**), each anchored.
- **AC2** (L181): `learner-deep-study.md` cited as design north star; 5 superiority dims explicitly mapped.
  - **AC2bis (spec reconciliation, in-plan)**: spec L181 currently reads "AC10–AC14"; the 5 superiority dims actually live at AC8–AC12 in this plan. **Patch diff to spec, applied as part of the Phase 0 commit:**
    ```diff
    - …5 superiority dims explicitly mapped to AC10–AC14
    + …5 superiority dims explicitly mapped to AC8–AC12 (append-and-revise, feedback flywheel, two-tier promotion, semantic similarity, tool-trace-aware extraction)
    ```
    Phase 0 commit message must mention "spec(AC2): renumber AC10–AC14 → AC8–AC12 to match plan ordering".
  - **AC2bis spec L90 patch — status enum**: spec L90 currently lists 4 status values. Apply as part of Phase 0 commit:
    ```diff
    - status: "draft" | "published" | "archived" | "disabled"
    + status: "draft" | "staging" | "published" | "archived" | "disabled"
    ```
    (5 values; `staging` added to reflect two-tier promotion tier)
  - **AC2bis spec L213–220 patch — evolution-path steps**: spec L213–220 currently lists 8 evolution-path steps. Rewrite to 10 steps matching §4.4 `test_evolution_path.ts` (adds auto-stage → graduate between steps 4–5 and explicit graduate via web API). Apply in same Phase 0 commit:
    ```diff
    - (8-step list at spec L213–220)
    + 1. setup  2. distill→draft  3. promote→published  4. distill→draft v0.2.0  5. auto-stage→.staging-skila/  6. graduate→published  7. feedback×3  8. rollback  9. disable  10. reactivate
    ```
- **AC3** (L182): git log proves the Decision Update commit lands strictly before any `src/`, `dist/`, `.claude-plugin/`, or `web/` file.

### Phase 1 — Plugin skeleton + npm package (L184–188)
- **AC4** (L185): `package.json` declares `@yao/skila`, `bin.skila=dist/cli.js`, `engines.node>=20`, `0.1.0`. **devDependencies** include `esbuild` and `tailwindcss` (dev-only, not in runtime `dependencies` tree).
- **AC5** (L186): `.claude-plugin/plugin.json` declares `/skila` + PostToolUse + Stop hooks → `dist/hooks/feedback.cjs`.
- **AC6** (L187): `smithery.yaml` declares `npx -y @yao/skila mcp` stdio.
- **AC7** (L188): `npm pack --dry-run` ships `dist/` (including `dist/web/vendor/cm.js` + `dist/web/vendor/tw.css`), `.claude-plugin/`, `smithery.yaml`, `README.md`, `LICENSE`. No CDN URLs in shipped HTML.

### Phase 2 — Five superiority dimensions (L190–195)
- **AC8** Append-and-revise (UPDATE→X with parentVersion, changelog).
- **AC9** Feedback flywheel (Stop hook updates `feedback.json` within 1s, end-to-end mocked-clock asserted).
- **AC10** Two-tier promotion (`.draft-skila/` default for distill output; auto-promote default → **`.staging-skila/` (still loader-invisible because `.`-prefixed); explicit user `graduate` promotes to published**). Manual `skila promote` continues to push directly to published.
- **AC11** Semantic similarity via LLM judge with three-input prompt (inventory, candidate, last-30 tool trace) **+ judge output shape + decision-classification + hallucination-guard tests**.
- **AC12** Tool-trace-aware extraction (judge prompt's distillation section explicitly cites tool sequence) **+ end-to-end behavior test on 3 fixture sessions**.

### Phase 3 — Web control panel (L197–203)
- **AC13** `skila serve` on `127.0.0.1:7777` with auto-increment + clean Ctrl-C.
- **AC14** `GET /` HTML; `GET /api/skills` JSON spans all 5 statuses (`draft | staging | published | archived | disabled`).
- **AC15** All write endpoints update disk + git commit (or flat snapshot). Concurrent feedback writes safe via lockfile (D6).
- **AC16** CodeMirror 6 editor (vendored, **no CDN**) loads/edits/saves via PUT, survives refresh.
- **AC17** Rollback creates new current version, never destroys history; revisionCount++ + changelog entry.
- **AC18** Visual gate ≥7/10 via `oh-my-claudecode:visual-verdict` against Obsidian/GitHub reference; sub-7 forces designer rework.
- **AC18b (NEW)** First-paint LCP ≤ 500ms on local vendor (deterministic, no network). Cold cache (first load, no prewarming): ≤ 500ms. Warm cache (subsequent load, OS file cache hot): ≤ 200ms. Both asserted in `tests/web/test_lcp_budget.ts`.
- **AC18c (NEW)** Web UI surfaces staging candidates with "graduate / reject" affordances, and surfaces `judge proposed UPDATE→<X> but X not found` warning when fallback fired.

### Phase 4 — Storage adapter (L205–209)
- **AC19** GitBackedStorage via `child_process.execFile` (no `simple-git`).
- **AC20** FlatFileStorage with identical interface, `versions/<name>/v0.X.Y/SKILL.md`.
- **AC21** Factory selects via `git --version` once, logs once, never re-warns. **No top-level `skila storage migrate` subcommand exists** (per D3 below); migration lives inside `skila doctor --fix-storage`.
- **AC22** All writes atomic via temp + `fs.rename`; kill -9 mid-write leaves old or new only.

### Phase 5 — Evolution-path e2e (L211–221) — **THE acceptance gate**
- **AC23** Full evolution-path script (distill → graduate-from-staging → revise → promote → feedback ×3 → rollback → disable → reactivate), each step asserts FS + git/flat + feedback.json state.

### Phase 6 — Quality bar dogfooding (L223–225)
- **AC24** skila ships as a real Anthropic skill package under `skills/skila/`.
- **AC25** `skila lint skills/skila/` returns 0 warnings.

---

## 2. RALPLAN-DR Decision Summary

### 2.1 Principles
1. **Zero runtime Python.** TS only; v1 substrate is fully discarded (spec L52, Round 8).
2. **Substrate parity with memex *for runtime*.** `node:http` + `tsc`-only build for app code; **a one-shot esbuild + tailwindcss step is permitted for vendor assets only** (spec L62 mandates `src→dist via tsc` — vendor bundling is a separate dev-time pipeline that does not violate this).
3. **Evidence over architecture-astronomy.** Every superiority dim is a learner gap with citation; every endpoint is one e2e step.
4. **Storage is invisible.** Git vs flat is selected once and never surfaces in UI or top-level CLI (P4).
5. **Quality bar is a runnable test, not a checklist.** AC23 is the gate; AC18 visual ≥7/10 + AC18b LCP ≤500ms are the second gates.
6. **Flywheel must turn but library must stay clean.** Auto-promotion always runs (to staging); only explicit user action touches published.

### 2.2 Decision Drivers (top 3)
1. **Time-to-AC23.** Every architectural choice must collapse, not expand, the path to a passing evolution-path script.
2. **Distribution surface = 3 (npm + plugin + smithery).** Anything that breaks `npm pack` portability or stdio MCP is rejected.
3. **Visual quality (AC18 ≥7/10) + first-paint (AC18b ≤500ms) are non-negotiable.** Any UI choice that risks either is rejected.

### 2.3 Viable Options per core architectural decision

#### D1. Web UI bundling strategy — **REVISED**
- **Option A — Single HTML + CDN imports.** *Iteration-1 choice; rejected by Architect (CDN ↔ AC18 visual gate + first-paint latency physically conflict; Tailwind-via-CDN is a documented anti-pattern).*
- **Option B — Single HTML + build-time vendored assets.** `scripts/postbuild.mjs` runs:
  1. `esbuild` once, bundles CodeMirror 6 + `@codemirror/lang-markdown` + `marked` → `dist/web/vendor/cm.js` (single ESM, ≈400KB minified, gzip ≈120KB).
  2. `tailwindcss` CLI once, scans `src/web/index.html` → `dist/web/vendor/tw.css` (purged, ≈25KB).
  3. Copies `src/web/index.html` → `dist/web/index.html` with `<script type="module" src="./vendor/cm.js">` and `<link rel="stylesheet" href="./vendor/tw.css">` references.
  - `package.json devDependencies`: `esbuild`, `tailwindcss`, `@codemirror/*`, `marked` (dev-only; runtime deps tree stays tiny).
  - `npm pack` includes `dist/web/vendor/*`; offline + deterministic + reproducible.
- **Option C — Vite minimal build.** **Invalidated** — spec L59 forbids Vite.
- **Decision: B (build-time vendor).** Resolves Iter-1 reject. Aligns with AC7 (`npm pack` self-contained), enables AC18b LCP ≤500ms (no network), removes CDN-drift risk class entirely. The spec's "src→dist via tsc" rule constrains *application* code, not vendor asset bundling.

#### D2. Hooks implementation path — unchanged
- **Decision: A (CJS bridge `dist/hooks/feedback.cjs`).** Spec L186-mandated. CJS bridge `require('../cli')` → exported `collectFeedback({event, tool, result})`; well under 1s.

#### D3. Storage adapter implementation — unchanged + scope tightening
- **Decision: A (`execFile('git', ...)`).** Spec L206-mandated.
- **Removed**: top-level `skila storage migrate` subcommand (Iteration-1 self-contradiction, flagged by both reviewers as P4 invisible-storage violation).
- **Added**: migration is invoked only via `skila doctor --fix-storage`, only after doctor detects a `.adapter-mode` mismatch, and only with explicit user confirmation. `.adapter-mode` sentinel still written on first run as a mismatch tripwire.

#### D4. CodeMirror 6 integration — **REVISED**
- **Decision: B (vendored ESM via esbuild).** Bundled into `dist/web/vendor/cm.js` per D1. Pinned `package.json devDependencies` versions. No `<noscript>` fallback necessary (vendor is local, can't fail to load).

#### D5 (NEW). Smithery `mcp` mode storage isolation
- **Problem**: Iteration-1 risk row "Smithery `mcp` forces flat" silently flips storage mode and would corrupt a real local user's git-backed history (Critic-flagged collision with Pre-mortem Scenario C "refuse silent switch").
- **Decision**: When invoked as `npx -y @yao/skila mcp` (Smithery transport), skila uses an ephemeral working dir `/tmp/skila-smithery-<pid>/` as `SKILA_HOME` (overrides `~/.claude/skila-data/`). Flat-only adapter is forced inside that dir. The user's real `~/.claude/skila-data/` is never read or written in this mode. Process exit removes the tmpdir. This makes Smithery's ephemeral nature physically incapable of touching local history — no policy needed, no silent-switch risk. Boot time scans `/tmp/skila-smithery-*` and removes orphaned dirs (mtime > 1h is considered an orphan). Smithery `mcp` mode is read-only with respect to the skill library: it only exposes `inspect`/`list`/`lint` commands; `distill`/`promote`/`graduate`/`archive`/`disable`/`reactivate`/`rollback`/`feedback` and all other mutation commands are disabled in this mode.
- **Test**: `tests/mcp/test_smithery_isolation.ts` — spawn `node dist/cli.js mcp`, assert `SKILA_HOME` env in child = tmpdir; assert no fd opened on `~/.claude/skila-data/`.

#### D6 (NEW). Concurrent feedback.json write safety (Hook × Web)
- **Problem**: PostToolUse/Stop hooks (potentially many per second under load) and Web PUT endpoints both mutate `feedback.json`. Iter-1 mentioned "concurrent append safety" in unit-test count but never made a design-level decision — Critic flagged as missing.
- **Decision**:
  - All `feedback.json` mutations go through `feedback/store.ts:withLock(fn)`.
  - `withLock` acquires an exclusive lockfile `feedback.json.lock` via `proper-lockfile`-style mkdir-based lock (no native dep — uses `fs.mkdir(lockdir, {recursive: false})` race semantics).
  - Acquire timeout 100ms; on timeout retry up to 3 times (jittered backoff 30–80ms). Lockfile mtime > 5s is considered stale and may be force-unlinked before next acquire attempt.
  - Inside lock: read-modify-write to `feedback.json.tmp` then `fs.rename` (atomic on POSIX + Windows ≥10).
  - Hook-side writes are async-queued (in-process tail-write queue) so a Stop-hook caller never blocks; web PUTs synchronously hold the lock.
- **Test**: `tests/feedback/test_concurrent_writes.ts` spawns 100 concurrent `incrementUsage(name)` calls; final `usageCount === 100` for every name; no `lock-not-released` warnings logged.

---

## 3. Pre-mortem (4 failure scenarios at v0.1 + 6 months)

### Scenario A — "The web UI is technically working but nobody uses it; users live in `/skila promote`."
- **Why it fails**: AC18 passed at 7/10 (just above threshold); CodeMirror reload latency made edits feel laggy; users dropped to CLI.
- **Earliest detectable signal**: ratio of `skila serve` uptime hours to `/skila promote` invocations <0.3 in week-1 dogfooding.
- **Mitigation**: (i) AC18 retest at 14 days post-launch with 5-real-edit-task protocol; (ii) instrument `~/.claude/skila-data/web-usage.log`; (iii) AC18b first-paint LCP ≤500ms gate (now achievable thanks to D1=B vendor bundling).

### Scenario B — "Auto-promotion fills published library with mediocre skills, user trust collapses." — **REVISED**
- **Why it fails (original framing)**: defaults `usageCount≥3 ∧ successRate≥0.7` were too coarse; published count balloons to 50+, half are duds.
- **Why Iteration-1 mitigation also fails**: shipping auto-promotion *disabled* satisfies "library stays clean" but kills the learning flywheel (the entire spec ~~hypothesis~~). Reviewers correctly flagged this as goal-incoherent.
- **Mitigation (Iteration 2)** — staging tier resolves the dilemma:
  - Auto-promotion is **on by default**, but the destination is `~/.claude/skills/.staging-skila/<name>/`, not the published dir. CC's skill loader still skips `.`-prefixed dirs, so library cleanliness is preserved.
  - Web UI dashboard surfaces "staging candidates ready to graduate" with one-click `graduate → published` and `reject → archive` actions.
  - Flywheel turns automatically (signal accumulates); library curation stays manual.
  - Floor preserved: ≥10 invocations OR ≥1 failure observation before staging promotion fires (prevents trivial 3/3 rubber-stamps).
  - `skila doctor` still flags published skills with `lastUsedAt > 60d`.

### Scenario C — "Storage adapter selection ping-pongs (git ↔ flat) and corrupts version history." — **REVISED**
- **Why it fails**: User in non-git dir → flat history accrues → later `git init` → factory flips → flat history invisible to git, web shows empty timeline.
- **Mitigation**: (i) Factory writes choice to `.adapter-mode` on first run; **refuses silent switch**; logs an actionable hint pointing at `skila doctor --fix-storage`. (ii) `doctor --fix-storage` snapshots flat history into git as one commit per version, chronological. (iii) `tests/storage/test_no_silent_switch.ts`. (iv) Smithery mode does not participate (D5: ephemeral tmpdir).

### Scenario D (NEW) — "LLM judge calls dominate cost/latency; users abandon `/skila` because every distill takes 10s+ or triggers token-budget warnings."
- **Why it fails**: Every distill hits the judge with a full inventory + candidate + tool-trace prompt; inventory grows to 80+ skills; each call is 6–10K input tokens at ~3s. Three distills/day × 30 days = noticeable cost line in user's Anthropic invoice and user-perceived sluggishness in `/skila`.
- **Earliest detectable signal**: p95 distill latency >5s in `~/.claude/skila-data/logs/skila-*.log`; or `judge_input_tokens` per call > 4000.
- **Mitigation**:
  1. **Token budget**: judge prompt cap 4K input tokens; builder truncates inventory section first (drop oldest-touched skills), then tool-trace tail, then candidate body — never silently drops `decision/justification` instructions.
  2. **Inventory hash cache**: `~/.claude/skila-data/judge-cache/inventory-<sha256>.json` keyed on (sorted skill names + mtimes); 7-day TTL; reused across distills if inventory unchanged → skips re-summarising.
  3. **Degraded-prompt path**: if computed prompt > 4K after pass-1 truncation, switch to "name-only inventory" prompt (just names + descriptions, no bodies); judge can still classify NEW vs UPDATE→X but cannot score similarity → returns `similarity: null` and `confidence: low`; orchestrator routes to `[NEW]` by default.
  4. **Telemetry**: every judge call logs `{prompt_tokens, latency_ms, mode: full|degraded|cached}`; `skila stats` exposes p50/p95.

---

## 4. Expanded Test Plan

### 4.1 Unit tests (target: ≥38 tests across modules)
| Module | Min tests | Focus |
|---|---|---|
| `inventory/frontmatter.ts` | 6 | parse valid + 5 invalid frontmatters; round-trip preserves key order |
| `inventory/scanner.ts` | 5 | walks 5 status dirs (incl. `.staging-skila`); handles missing dirs; symlink safety |
| `validate/validate.ts` | 8 | each blocking rule |
| `validate/lint.ts` | 4 | advisory heuristics return warnings not errors |
| `storage/atomic.ts` | 4 | rename atomicity, temp cleanup, cross-device EXDEV fallback |
| `feedback/store.ts` | 5 | counter math, JSON corruption recovery, lock acquire/release, lock timeout retry, lock-leak after crash |
| `config/config.ts` | 3 | defaults, override, schema validation |
| `judge/budget.ts` (NEW) | 3 | full → degraded → cached prompt-mode transitions for D5 mitigation |

### 4.2 Integration tests (module contracts)
- **storage adapter ↔ command layer**: parameterised over both adapters, every command exercised. 10 tests = 5 commands × 2 adapters.
- **judge ↔ inventory**: judge prompt builder consumes inventory scanner output; assert prompt size budget ≤ 4K tokens (D5); assert degraded-path fires when forced.
- **hooks ↔ feedback store**: simulate 100 PostToolUse events in 1s, assert no lost writes, final counters match (D6 lock test).
- **web API ↔ storage adapter**: every PUT/POST endpoint exercised with both adapters via the same fixture.

### 4.3 Judge behaviour tests (NEW — per Iter-2 item #4)
| File | Purpose |
|---|---|
| `tests/judge/test_judge_output_shape.ts` | Fixture session + fixture inventory → judge call; assert returned JSON has keys `decision`, `similarity`, `justification`, `suggested_version_bump`. Mock-mode default (deterministic stub); `JUDGE_LIVE=1` runs against real model. |
| `tests/judge/test_judge_decision_classification.ts` | 3 fixture sessions: (a) unrelated (expect `decision=NEW`), (b) partially related to existing `azure-pipeline-debug` (expect `decision=UPDATE`, `target_name=azure-pipeline-debug`), (c) strongly related but different file domain (expect `decision=NEW` with high `similarity`). Assert classifications. |
| `tests/judge/test_judge_hallucination_guard.ts` | Inject mocked judge output with `decision=UPDATE, target_name=does-not-exist`. Drive through `distill orchestrator`; assert it downgrades to `[NEW]`, logs `judge proposed UPDATE→does-not-exist but does-not-exist not found`, and the web UI surface receives a structured warning record. |

### 4.4 E2E tests
- `tests/e2e/test_revise_path.ts` (AC8)
- `tests/e2e/test_feedback_loop.ts` (AC9) — **uses `vi.useFakeTimers()` to assert hook→feedback.json end-to-end ≤ 1000ms deterministically (no wall-clock flake)**; also asserts `queueDepth ≤ 10` under burst test (50 PostToolUse fires within 100ms)
- `tests/e2e/test_promotion_gate.ts` (AC10) — **covers staging tier**: distill → auto-stage → graduate → published; also covers reject → archive
- `tests/e2e/test_rollback.ts` (AC17)
- `tests/web/test_editor_e2e.ts` (AC16, agent-browser driven, vendored CM only)
- `tests/web/test_lcp_budget.ts` (AC18b) — agent-browser captures LCP, asserts ≤500ms over loopback
- `tests/feedback/test_concurrent_writes.ts` (D6) — 100 concurrent writers, no lost counts
- `tests/mcp/test_smithery_isolation.ts` (D5) — Smithery mode never touches `~/.claude/skila-data/`
- `tests/e2e/test_evolution_path.ts` (AC23) — **expanded script (10 steps)**:
  1. setup: clean HOME; init git in skila-data.
  2. `skila distill --from-fixture session-1.md` → assert `.draft-skila/azure-pipeline-debug/SKILL.md` v0.1.0; git log `distill: …`.
  3. `skila promote azure-pipeline-debug` → published v0.1.0.
  4. `skila distill --from-fixture session-2.md` → judge UPDATE→azure-pipeline-debug; **draft v0.2.0 with parentVersion=0.1.0**.
  5. Auto-promotion fires (usage threshold met) → file lands in `.staging-skila/`, NOT published.
  6. Web `POST /api/skills/azure-pipeline-debug/graduate` → published v0.2.0; v0.1.0 retrievable via `skila inspect --version 0.1.0`.
  7. `skila feedback azure-pipeline-debug --outcome success` ×3 → `feedback.json["azure-pipeline-debug"].usageCount=3, successRate=1.0` within lock.
  8. `skila rollback azure-pipeline-debug --to 0.1.0` → published v0.3.0 bytes-equal v0.1.0; revisionCount=3.
  9. `skila disable azure-pipeline-debug` → `.disabled-skila/`.
  10. `skila reactivate azure-pipeline-debug` → published; teardown asserts no orphan temp/lock files.

### 4.5 Observability
- Logs: `~/.claude/skila-data/logs/skila-YYYY-MM-DD.log` NDJSON; one entry per command + hook + judge call; rotated daily, ≤7-day retention.
- Metrics: `GET /api/dashboard` + `skila stats` (judge p50/p95, lock contention, staging backlog).
- `skila doctor` (writes Phase 3) checks: Node ≥20, git availability + `.adapter-mode` consistency, `~/.claude/skills/` writable, plugin.json hook resolution, port 7777, feedback.json schema, lock-leak detection, stale staging > 30d, judge cache > 7d → prune.
- `skila doctor --fix-storage` is the only path that may convert flat → git history.
- `skila selftest` runs e2e fixture against tmpdir HOME.

---

## 5. Phased Implementation Steps

### Phase 0 — Research-first hard gate
1. Append "Decision Update — v2" to `docs/research/hermes-and-memex-study.md` with **6** entries:
   TS substrate, web panel, npm distribution, feedback hooks, **build-time vendor (no CDN)**, **staging-tier auto-promotion**.
2. Apply AC2 patch to spec: rewrite "AC10–AC14" → "AC8–AC12" in `.omc/specs/deep-interview-skila-v2.md` L181.
3. `git add docs/research/ .omc/specs/ .omc/plans/ && git commit -m "docs(research): v2 Decision Update + spec(AC2): renumber to AC8–AC12"`.
4. Verify AC3.

### Phase 1 — Plugin skeleton + npm package
1. `package.json` (`@yao/skila`, bin, engines, scripts: `build`, `postbuild`, `test`, `pack:check`, `mcp`, `serve`); devDeps add `esbuild`, `tailwindcss`, `@codemirror/state`, `@codemirror/view`, `@codemirror/lang-markdown`, `marked`.
2. `tsconfig.json` (target ES2022, module NodeNext, outDir `dist`, strict).
3. `scripts/postbuild.mjs`: copy `src/web/index.html`; **esbuild bundle vendor → `dist/web/vendor/cm.js`**; **tailwindcss CLI → `dist/web/vendor/tw.css`**; copy `src/hooks/feedback.cjs` → `dist/hooks/`.
4. `.claude-plugin/plugin.json` slash + 2 hooks.
5. `smithery.yaml`.
6. README skeleton + LICENSE.
7. Stub `src/cli.ts`.
8. Verify AC4–AC7: `npm run build && npm pack --dry-run`; assert `dist/web/vendor/cm.js` + `tw.css` listed; grep `index.html` for any `https://` (must be zero).
9. Commit.

### Phase 2 — Five superiority dimensions
1. `inventory/scanner.ts` + `frontmatter.ts` (now scans 5 status dirs; frontmatter validation rules accept `status: "draft" | "staging" | "published" | "archived" | "disabled"` — 5 values).
2. `distill/extractor.ts`.
3. `judge/prompt.ts` + `judge.ts` + `judge/budget.ts` (D5 token cap).
4. `commands/distill.ts` orchestrator (judge-output validation + hallucination fallback).
5. `validate/validate.ts` + `lint.ts`.
6. `commands/promote.ts` + revise flow.
7. `feedback/store.ts` (with `withLock`, D6) + `feedback/collector.ts` + `hooks/feedback.cjs` (AC9).
8. **Auto-promotion → `.staging-skila/`** (Scenario B mitigation).
9. Per-AC unit + integration + judge-behaviour tests.
10. Commit per AC pass.

### Phase 3 — Web control panel
1. `web/server.ts` — `node:http`, port 7777 auto-increment, `skila_token` cookie middleware.
2. API endpoints in dependency order, including `POST /api/skills/:name/graduate` and `POST /api/skills/:name/reject` (staging actions).
3. `web/index.html` — three-pane layout, references vendored `./vendor/cm.js` + `./vendor/tw.css` only (no `https://`).
4. CodeMirror 6 wiring via vendored ESM.
5. AC18 visual verdict run; AC18b LCP capture.
6. `commands/serve.ts`.
7. `commands/doctor.ts` including `--fix-storage`.
8. Commit per endpoint group + visual gate commit.

### Phase 4 — Storage adapter
1. `storage/atomic.ts`.
2. `storage/git.ts` execFile wrappers.
3. `storage/flat.ts`.
4. `storage/index.ts` factory + `.adapter-mode` sentinel.
5. **No `commands/storage.ts`** — migration logic lives in `commands/doctor.ts:fixStorage()`.
6. Tests: AC19, AC20, AC21, AC22, `test_no_silent_switch.ts`.

### Phase 5 — Evolution-path e2e
1. Fixtures `session-1.md`, `session-2.md`.
2. Implement `tests/e2e/test_evolution_path.ts` (10 steps).
3. Run matrix git × flat — both must pass.
4. Commit.

### Phase 6 — Quality bar dogfooding
1. Author `skills/skila/SKILL.md`.
2. Compile validate/lint/scan helpers under `skills/skila/scripts/`.
3. Populate `references/` + `assets/`.
4. `skila lint skills/skila/` → AC25 zero warnings.
5. Final commit.

---

## 6. Acceptance Criteria — How each is tested

| AC | Test mechanism | Pass condition |
|---|---|---|
| AC1 | grep `Decision Update — v2` + 6 anchored entries | section present, 6 entries |
| AC2 | grep north-star ref + mapping table | mapping present, references AC8–AC12 |
| AC2bis | `git diff` of spec L181 in Phase 0 commit | diff matches the patch shown in §1 |
| AC3 | `git log --diff-filter=A --name-only --reverse` | research first |
| AC4 | inspect `package.json` | name/bin/engines/version + esbuild + tailwindcss in devDependencies |
| AC5 | inspect `.claude-plugin/plugin.json` | slash + 2 hooks present, paths in dist |
| AC6 | inspect `smithery.yaml` | npx + stdio |
| AC7 | `npm pack --dry-run` | required files including `dist/web/vendor/*`; `grep https:// dist/web/index.html` returns 0 |
| AC8 | `tests/e2e/test_revise_path.ts` | UPDATE row, v0.2.0, parentVersion=0.1.0 |
| AC9 | `tests/e2e/test_feedback_loop.ts` w/ `vi.useFakeTimers()` | mocked-clock end-to-end ≤1000ms |
| AC10 | `tests/e2e/test_promotion_gate.ts` | drafts → `.draft-skila/`; auto-promote → `.staging-skila/`; loader skip verified |
| AC11 | `tests/judge/test_judge_prompt.ts` + `test_judge_output_shape.ts` + `test_judge_decision_classification.ts` | prompt has 3 inputs; output shape asserted; 3 classifications correct |
| AC12 | `tests/judge/test_extraction_uses_tool_trace.ts` + `test_judge_hallucination_guard.ts` | extractor reads trace; hallucinated UPDATE→X falls back to `[NEW]` and surfaces warning |
| AC13 | start `skila serve`, hit port, SIGINT | bind, auto-increment, clean exit |
| AC14 | curl `/` and `/api/skills` | HTML OK, JSON has 5 buckets |
| AC15 | `tests/web/test_api_endpoints.ts` | each write reflected on disk + git/flat |
| AC16 | `tests/web/test_editor_e2e.ts` agent-browser | edit → save → reload persists; vendor only |
| AC17 | `tests/e2e/test_rollback.ts` | new current + history retained + revisionCount/changelog |
| AC18 | agent-browser + `oh-my-claudecode:visual-verdict` | ≥7/10 |
| AC18b | `tests/web/test_lcp_budget.ts` | LCP cold ≤500ms; warm ≤200ms |
| AC18c | agent-browser staging UI test | graduate/reject buttons + hallucination warning rendered |
| AC19 | `tests/storage/test_adapter_selection.ts` git mode | execFile-based, no simple-git import |
| AC20 | same, flat mode | dir layout matches spec |
| AC21 | double-boot + no top-level `skila storage migrate` | one log line, no warning, refuses silent switch, top-level subcommand absent |
| AC22 | `tests/storage/test_atomic_writes.ts` w/ kill -9 fork | file old or new bytes, never partial |
| AC23 | `tests/e2e/test_evolution_path.ts` | all 10 steps pass under both adapters |
| AC24 | inspect `skills/skila/` | full tree present |
| AC25 | `node dist/cli.js lint skills/skila/` | exit 0, zero warnings |

---

## 7. Risks + Mitigations

| Risk | Likelihood | Impact | Mitigation (specific & assertable) |
|---|---|---|---|
| Visual gate AC18 fails repeatedly | Medium | High | Engage `designer` at Phase 3 step 3 before screenshot capture; iterate on Tailwind utilities; reference Obsidian + GitHub class palettes |
| AC9 1s feedback budget missed under load | Medium | Medium | `tests/e2e/test_feedback_loop.ts` mocks `Date.now()` and asserts hook invocation → `feedback.json` mtime delta ≤ 1000ms end-to-end; CJS bridge synchronous append + `O_APPEND`; if exceeded, executor must add async batch queue and re-prove |
| LLM judge hallucinates UPDATE→nonexistent | Medium | High | `distill orchestrator` immediately after receiving judge output runs `inventory.has(target_name)`; if false, downgrades to `[NEW]` and emits structured warning record `{type: "judge_hallucination", proposed: target_name}` consumed by Web UI banner. Asserted by `tests/judge/test_judge_hallucination_guard.ts` |
| Auto-promotion pollutes published library (Scenario B) | High if naive | High | Auto-promote target is `.staging-skila/` (loader-invisible); only explicit user `graduate` reaches published; floor: ≥10 invocations OR ≥1 failure before staging fires |
| Storage adapter silent switch (Scenario C) | Low | Critical | `.adapter-mode` sentinel; refuse silent switch; fix only via `skila doctor --fix-storage`; Smithery isolated to tmpdir (D5) |
| `npm pack` ships unintended files | Low | Medium | Explicit `files` field; CI runs `npm pack --dry-run` and asserts fixed list including vendor assets |
| Smithery deploy fails | Low | Medium | D5: ephemeral tmpdir + flat-only; never invokes git; `tests/mcp/test_smithery_isolation.ts` |
| Plugin marketplace hook path mismatch | Medium | Medium | plugin.json paths resolved via `${__dirname}` shim in `feedback.cjs`; integration test installs via `npm pack` + `npm i -g <tarball>` |
| Concurrent feedback.json writes lose data (D6) | Medium | High | `withLock` + atomic rename; `tests/feedback/test_concurrent_writes.ts` 100 writers must reach `usageCount === 100` |
| Judge cost/latency spirals (Scenario D) | Medium | High | 4K-token budget; 7-day inventory hash cache; degraded prompt path; `skila stats` exposes p50/p95 |

(Iter-1 row "CDN drift → quarterly doctor check" deleted — D1 decision change makes the risk class non-existent.)

---

## 8. Verification Steps

1. **Phase 0**: `git log --diff-filter=A --name-only --reverse | head -50` shows research/spec/plan first; spec L181 diff present.
2. **Phase 1**: `npm run build && npm pack --dry-run | tee /tmp/pack.txt` matches expected file list incl. `dist/web/vendor/cm.js` + `tw.css`; `grep -c https:// dist/web/index.html` == 0.
3. **Phase 2**: unit + integration + judge-behaviour suite green; `tests/e2e/test_revise_path.ts`, `test_feedback_loop.ts` (mocked clock), `test_promotion_gate.ts` (staging path), `tests/feedback/test_concurrent_writes.ts` green.
4. **Phase 3**: `skila serve` boots; agent-browser editor e2e green; visual ≥7/10 captured; `tests/web/test_lcp_budget.ts` ≤500ms.
5. **Phase 4**: storage adapter parameterised suite green for both modes; `test_no_silent_switch.ts` green; `tests/mcp/test_smithery_isolation.ts` green.
6. **Phase 5**: `tests/e2e/test_evolution_path.ts` (10 steps) green under git × flat matrix.
7. **Phase 6**: `node dist/cli.js lint skills/skila/` exit 0.
8. **Whole-project**: `oh-my-claudecode:verify` with 25-AC checklist; reviewer agent (separate context) signs off.
9. **Observability check**: `skila doctor` and `skila selftest` exit 0 on clean machine.
10. **Distribution smoke**: `npm pack` → `npm i -g ./yao-skila-0.1.0.tgz` → `skila --version`; plugin install path verified; smithery `npx -y @yao/skila mcp` stdio handshake; assert handshake never opened fd on `~/.claude/skila-data/`.

---

## Iteration 2 Changelog

Each entry maps 1:1 to the 9 must-fix items from Architect (REVISE-REQUIRED) + Critic (REJECT) consensus.

1. **D1 + D4 → build-time vendored assets, no CDN.** Architect: "CDN ↔ AC18 visual gate + first-paint latency physically conflict; Tailwind via CDN is a documented anti-pattern." Critic: "spec L62 is `src→dist via tsc`, doesn't forbid vendor bundling via esbuild." Fix: rewrote D1/D4; `scripts/postbuild.mjs` runs esbuild + tailwindcss once into `dist/web/vendor/`; added devDeps `esbuild` + `tailwindcss`; runtime stays single-HTML + local vendor; added **AC18b LCP ≤ 500ms** as a new acceptance criterion that local vendoring trivially satisfies. Risk row "CDN drift" deleted.

2. **Auto-promotion default conflict → staging tier.** Architect+Critic: "default-off kills the flywheel; default-on pollutes the library — Iter-1 picked one horn, neither is acceptable." Fix: Phase 0 Decision Update now has the explicit reconcile entry; Pre-mortem Scenario B rewritten; AC10 wording changed from "default off" to "auto-promote to `.staging-skila/` (loader-invisible); user explicit `graduate` reaches published"; new endpoints `/api/skills/:name/graduate` + `/reject`; new AC18c covers UI surfacing.

3. **`skila storage migrate` removed.** Architect: "self-contradiction with P4 invisible storage." Critic: "plan fights itself." Fix: deleted top-level `commands/storage.ts`; migration moved into `skila doctor --fix-storage` requiring user confirmation; `.adapter-mode` sentinel kept as tripwire; AC21 pass condition updated to assert top-level subcommand is absent.

4. **AC11/AC12 judge behaviour tests.** Critic #4 + Architect P3: "Iter-1 only tests prompt-string assembly; zero coverage of judge output shape/distribution." Fix: §4.3 adds three new tests — `test_judge_output_shape.ts`, `test_judge_decision_classification.ts`, `test_judge_hallucination_guard.ts`. Mock-mode default (CI cost), `JUDGE_LIVE=1` for real model. AC11/AC12 acceptance rows reference them.

5. **D5 Smithery isolation.** Critic: "`mcp`-forces-flat ↔ Scenario C `refuse silent switch` mutually exclusive in the running user's account." Fix: new D5 — Smithery mode uses ephemeral `/tmp/skila-smithery-<pid>/` as `SKILA_HOME`; user's real skila-data is never touched; `tests/mcp/test_smithery_isolation.ts` enforces.

6. **AC2bis spec patch in-plan.** Both reviewers: "don't push spec reconciliation downstream." Fix: §1 AC2bis now ships an explicit spec diff; Phase 0 step 2 applies it; Phase 0 commit message includes `spec(AC2): renumber AC10–AC14 → AC8–AC12`.

7. **Pre-mortem Scenario D added.** Reviewer note: "you missed the deadliest failure mode — judge cost/latency." Fix: §3 Scenario D added; mitigation has 4 concrete sub-mechanisms (4K token cap, inventory hash cache 7d TTL, degraded prompt path, telemetry); `judge/budget.ts` gets dedicated unit tests.

8. **D6 feedback.json concurrency design.** Critic-flagged. Fix: new D6 — `withLock` lockfile (`feedback.json.lock`) with 100ms timeout + 3 retries + atomic rename; hook-side async-queued, web-side synchronous; new `tests/feedback/test_concurrent_writes.ts` with 100 concurrent writers asserts no lost counts.

9. **Risk-table mitigation specificity.** Critic: "Iter-1 mitigations were aspirational." Fix:
   - AC9 row now references `tests/e2e/test_feedback_loop.ts` with `vi.useFakeTimers()` asserting end-to-end hook→`feedback.json` mtime delta ≤ 1000ms.
   - "CDN drift" row deleted (D1 decision retired the risk).
   - "judge hallucination" row now points at `distill orchestrator` doing `inventory.has(target_name)` synchronously after judge call, with structured `{type: "judge_hallucination", proposed: X}` warning surfaced in Web UI; asserted by `tests/judge/test_judge_hallucination_guard.ts`.

---

## Iteration 2 Polish

Applied after Architect REVISE-REQUIRED (1 mandatory + 3 polish) + Critic APPROVE (1 mandatory + 3 polish) consensus. Both reviewers agreed Iteration 3 benefit < cost; patches merged directly.

1. **Status enum extended to 5 values** (Architect + Critic independently confirmed): spec L90 patched in §AC2bis to add `"staging"` → `"draft" | "staging" | "published" | "archived" | "disabled"`; Phase 2 frontmatter validation rule updated in §Phase 2 step 1; AC14 updated to list all 5 values.

2. **Spec evolution-path drift fixed** (Critic): spec L213–220 had 8 steps; §AC2bis now includes an explicit diff patch aligning it with the 10-step `test_evolution_path.ts` script (adds auto-stage → graduate); Phase 0 commit applies both spec patches together.

3. **D6×AC9 queue-depth assertion** (Critic): `tests/e2e/test_feedback_loop.ts` now also asserts `queueDepth ≤ 10` under burst test (50 PostToolUse fires within 100ms).

4. **D5 orphan tmpdir cleanup** (Architect polish): D5 now specifies that on boot, skila scans `/tmp/skila-smithery-*` and removes dirs with mtime > 1h (orphan threshold).

5. **D6 stale lock reclaim** (Architect polish): D6 `withLock` now specifies that lockfile mtime > 5s is treated as stale and may be force-unlinked before the next acquire attempt.

6. **Smithery mutation boundary** (Architect polish): D5 now explicitly lists that Smithery `mcp` mode is read-only — only `inspect`/`list`/`lint` are exposed; all mutation commands (`distill`/`promote`/`graduate`/`archive`/`disable`/`reactivate`/`rollback`/`feedback`) are disabled.

7. **AC18b LCP cold/warm distinction** (Critic polish): AC18b now specifies cold cache ≤ 500ms and warm cache ≤ 200ms, both asserted in `tests/web/test_lcp_budget.ts`; acceptance table updated accordingly.

---

## ADR — Architectural Decision Record

### Decision
Adopt **TypeScript-only single-package distribution (`@yao/skila`) with build-time vendored web UI, two-tier draft/staging/published lifecycle, git-backed (auto-degrading to flat-file) versioned storage, plugin.json-declared PostToolUse+Stop hooks for feedback collection, and an LLM judge agent that consumes session memory + tool-call trace + inventory for similarity & criteria evaluation.**

### Drivers
1. **Substrate parity with memex (TS + npm + plugin + smithery)** — proven distribution path that satisfies the spec's zero-runtime-Python requirement and keeps the package portable via `npm pack`.
2. **AC23 evolution-path e2e as the architectural gate** — every design choice must collapse, not expand, the path to a passing 10-step evolution-path script covering the full skill lifecycle.
3. **Visual quality (AC18 ≥7/10) + first-paint (AC18b ≤500ms cold) are non-negotiable** — any UI bundling choice that risks either constraint is rejected at the decision level.

### Alternatives Considered
- **Pure-skill markdown only (v1's discarded path)**: rejected — see Iteration 1 changelog item, cannot satisfy AC18 (web), AC23 (evolution e2e), AC9 (feedback loop)
- **CDN-only web vendor (Iteration 1 D1/D4)**: rejected after Architect+Critic dual reject — physical conflict with AC18b LCP budget + offline ops + Tailwind-via-CDN anti-pattern
- **simple-git / nodegit storage**: rejected per spec L206 + nodegit native-build conflict with `npm pack` portability
- **Direct-to-published auto-promote**: rejected (Iteration 1) → introduces staging tier per Iteration 2

### Why chosen
- Substrate parity with memex (TS+npm+plugin+smithery) — proven distribution path
- Build-time vendor preserves "single HTML at runtime" property without CDN runtime dependency
- Staging tier reconciles "library cleanliness" with "learning flywheel turns"
- Hooks via plugin.json = zero user config (memex pattern)

### Consequences
- (+) AC23 evolution-path e2e covers the entire lifecycle including rollback and reactivate
- (+) Visual gate AC18 ≥7/10 + AC18b LCP ≤500ms cold / ≤200ms warm ensures web UI not "丑"
- (-) esbuild as dev-dependency is the first build-time tool beyond tsc — must document in spec L59 carve-out
- (-) Two-tier promotion adds one user concept (`staging`) beyond memex's flat model
- (-) Storage adapter must keep git/flat behavioural parity (test matrix burden)

### Follow-ups (post-v0.1)
- v0.2: cross-machine skill sync via git remote
- v0.2: real-time WebSocket updates in web UI
- v0.2: skill marketplace / sharing between users
- v0.2: embedding-based similarity if LLM judge precision plateaus
