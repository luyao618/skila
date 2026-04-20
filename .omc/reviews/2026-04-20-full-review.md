# skila — Full Code Review (2026-04-20)

Independent review of the ralph-built codebase across 6 parallel sub-agents
(5 × code-reviewer + 1 × security-reviewer). Build = green, vitest = green at
review time, but several test passes are vacuous or bypass the hot path.

Slices reviewed:
1. CLI surface & command layer
2. Distill + Judge pipeline
3. Inventory + Storage adapters
4. Feedback hook + collector
5. Web control panel (server + API + frontend)
6. Security / MCP / Smithery isolation

---

## 🔴 CRITICAL (9)

| ID | File | Issue | PRD impact |
|----|------|-------|-----------|
| C1 | `src/judge/budget.ts:102-104` | `buildBudgetedPrompt` writes cache then immediately reads → first call is labelled `"cached"`. Test passes vacuously. Cache provides zero observable benefit. | AC11 evidence false |
| C2 | `src/commands/distill.ts:38` | Hallucination guard is `Map.has(target)` only. `decision="UPDATE", target_name=null` silently slips into NEW branch with no warning. | AC12 false-positive |
| C3 | `src/judge/prompt.ts:42`, `src/distill/prompt.ts:11-21`, `src/judge/budget.ts:99,117,130` | All user-controlled strings (candidate body, inventory descriptions, tool args) interpolated raw — no fence delimiters, no length caps. Prompt-injection foothold. | AC11 |
| C4 | `src/storage/atomic.ts:14-30` | No `fsync(file)` before rename, no `fsync(dir)` after. Power-loss safety not guaranteed (only kill -9 covered). | AC22 partial |
| C5 | `src/storage/atomic.ts:22-25` | EXDEV fallback uses `copyFileSync` directly into `target` — completely non-atomic. | AC22 |
| C6 | `src/storage/index.ts:92-117` | Sentinel-missing path falls through to first-run probe even when `.git/` or `versions/` exist → silent adapter switch on backup-restore / sync-tool deletion. "No silent switch" rule has a hole. | AC21 evidence false |
| C7 | `src/web/api/files.ts:18-28` | Path-traversal defence via string prefix + `includes("..")`; **no symlink resolution**, **endpoint unauthenticated**. Malicious skill bundle with `scripts/leak → ~/.ssh/id_rsa` → arbitrary file read. | AC15 / security |
| C8 | `src/web/middleware/token.ts` + `src/web/index.html:242` | Cookie is `HttpOnly` but front-end calls `document.cookie` to populate `X-Skila-Token` header → header always empty. CSRF rests entirely on `SameSite=Strict` cookie ride-along; future maintainer "fix" likely removes HttpOnly → XSS regression. | AC13 silent bug |
| C9 | `src/hooks/feedback.cjs:23` ↔ `src/feedback/collector.ts:69-70` | Bridge never maps Claude's `tool_name`/`tool_input` to `skill`. Hook is a real-world no-op. AC9 unit test calls `incrementUsage` directly, bypassing the hook entirely. Flywheel is wired to a dead nerve. | AC9 evidence false |

---

## 🟠 HIGH (25)

### Distill / Judge
- **H1** `src/judge/judge.ts:25` — fixture short-circuit means classification tests round-trip canned JSON; the heuristic at lines 35-65 is never exercised by the "classification" tests.
- **H2** `src/judge/judge.ts:46` — heuristic uses `invTokens.length` as denominator (zero when description empty); `tokens.includes(t)` is substring match (`docker` matches `dockerfile`); threshold 0.4 is a magic constant.
- **H3** `src/promote/auto.ts:19-32` — `existsSync(dest)` → `moveSkillDir` is TOCTOU; concurrent hook invocations can double-promote; `failureCount >= 1` threshold may be too aggressive for fresh drafts.
- **H4** `src/distill/extractor.ts:36-55` — extractor is trace-agnostic (only attaches `toolTrace` to candidate object). AC12 "tool-trace-aware extraction" is cargo-cult.

### Storage
- **H5** `src/storage/git.ts`, `src/storage/flat.ts` (passim) — no path-traversal validation on `name` / `version` in storage layer; defence-in-depth missing.
- **H6** `src/storage/git.ts:110-115` — `git mv` failure fallback uses `copyFileSync` then `git add toRel`, never `git rm --cached fromRel`. Skill ends tracked in two locations.
- **H7** `src/storage/git.ts:102-133`, `src/storage/flat.ts:65-84` — `moveSkill` not atomic across repo + live tree. Crash mid-move leaves split state.
- **H8** `src/storage/git.ts:71-84` — pre-existing user repo / uncommitted state / GPG signing not handled; hard-codes `user.email=skila@local`.
- **H9** `src/storage/git.ts:143-211` — version → SHA resolution by substring match `[v1.2.3]` is ambiguous when two skills share a version.
- **H10** `src/inventory/frontmatter.ts:152-161` — serializer doesn't quote `[`, `]`, `,`, `&`, `*`, `!`. Output is **invalid YAML** for any external consumer.
- **H11** `src/inventory/frontmatter.ts:25-83` — parser ignores flow `[]` sequences, mishandles block scalars `|`, coerces numeric-looking strings (`version: "1"` → number).
- **H12** `src/inventory/scanner.ts:19-58` — `statSync` follows symlinks; no loop or out-of-root guard.

### Web
- **H13** `src/web/api/skills.ts:72-79, 122-125` — PUT/POST endpoints have **no body-size cap, no Content-Type check** → loopback OOM trivially.
- **H14** `src/web/server.ts:165-177` — `serveStatic` uses `replace(/\.\./g, "")` instead of real `realpath`-based containment check; fragile.
- **H15** `src/web/api/versions.ts:15-21` — every error becomes `200 []`, masking IO failures.
- **H16** `src/web/api/skills.ts:94-99` — mtime optimistic lock only fires when client sends `mtime`; otherwise last-write-wins silently.
- **H17** **DNS rebinding** — `src/web/server.ts` doesn't validate `Host` / `Origin`; `SameSite=Strict` doesn't save you after rebind. Remote attacker can trigger lifecycle mutations through victim's browser.

### CLI / Hooks
- **H18** `src/cli.ts:112` — `serve --port` not declared in `parseArgs.options` → flag silently ignored, falls back to config or 7777.
- **H19** `src/cli.ts:154-159` — ESM/CJS dual-bin detection uses `endsWith("cli.js")`; on Windows / pnpm shim `main()` may never run.
- **H20** `src/cli.ts:43+` — lifecycle commands have no try/catch; any error dumps full stack to stderr.
- **H21** `src/cli.ts:83, 101` — `--outcome` and `--status` cast `as any`, no validation.
- **H22** `src/commands/mcp.ts:57` — `runInspect` is async but **not awaited**; MCP returns `{result: {}}`.
- **H23** `src/hooks/feedback.cjs:25` — every PostToolUse dynamic-imports entire `dist/cli.js` (commander + judge + web bootstrap…). 50–200 ms cold start × N tool uses.
- **H24** `src/feedback/store.ts:47` — retry condition is `&& attempt >= 3`, should be `||` to honour "100 ms timeout, max 3 retries" spec.
- **H25** `src/feedback/collector.ts:42-48` — when queue ≥ 10, events are silently **dropped**; AC9 satisfied by data loss.

---

## 🟡 MEDIUM (22)

- M1 `src/commands/doctor.ts:78-103` — `checkPluginJson` doesn't substitute `${CLAUDE_PLUGIN_ROOT}` → false-negative hook missing.
- M2 `src/commands/doctor.ts:117-129` — `checkPort(7777)` reports `ok:false` when port is in use, contradicting AC13 auto-increment semantics.
- M3 `src/commands/doctor.ts:105-115` — `__dirnameSafe` uses `URL.pathname`, broken on Windows.
- M4 `src/commands/_lifecycle.ts:64-67` — non-`E_ADAPTER_MISMATCH` adapter errors silently swallowed; live FS moved but version history never recorded.
- M5 `src/storage/flat.ts:98-121` — version listing sorted by `meta.json.date`, not semver; clock skew → wrong order.
- M6 `src/storage/flat.ts:152-165` — `manualUnifiedDiff` lacks `@@ hunk @@` headers; not patchable by `patch(1)`.
- M7 `src/storage/git.ts:79-83` — no `.gitignore` for `.adapter-mode`, `.write-probe`, `.tmp-*`.
- M8 `src/judge/budget.ts:113-152` — budget loop edge cases: `tokens > budget` can still return `mode:"degraded"`; `mode:"full"` may report 0 inventory items; `writeFileSync` cache non-atomic.
- M9 `src/validate/validate.ts:38` — `version` not shape-validated (`NaN.NaN.NaN` passes).
- M10 `scripts/run-visual-verdict.mjs` + `tests/web/test_visual_verdict.ts` — script never prints `score: <n>`, so `expect(score).toBeGreaterThanOrEqual(7)` never fires. **Visual gate is empty.**
- M11 `tests/web/test_lcp_budget.ts` — measures HTTP RTT, not LCP; 500 ms budget on loopback always passes; misleading name.
- M12 `scripts/postbuild.mjs` — does not enforce `grep -F https:// dist/web/index.html` at build time (AC16 only checked in tests). Also clobbers user edits to `src/web/vendor-entry.mjs` on every build.
- M13 `scripts/ac18-screenshots.mjs:10` — hard-coded 24-byte token literal committed to repo.
- M14 `src/web/index.html:324, 432, 498, 588, 622-672` — interpolates `name` / `description` into `innerHTML` with no HTML escaping; combined with no CSP, malicious LLM-authored description executes as live HTML.
- M15 `src/web/server.ts:76` — only `X-Content-Type-Options: nosniff` is set. Missing CSP, X-Frame-Options, COOP, Referrer-Policy.
- M16 `src/commands/mcp.ts:17-34` — `/tmp/skila-smithery-<pid>` predictable; on shared `/tmp` an attacker can pre-plant a symlink. Use `mkdtempSync`.
- M17 `src/storage/git.ts:110` — `git mv` lacks `--` end-of-options sentinel.
- M18 `src/feedback/store.ts:106` — `invocations[]` unbounded; 10k entries → 1.2 MB rewrite per hook, blows 1 s budget.
- M19 `src/feedback/store.ts:148-150` — `recordInvocationSync` busy-spins at 100% CPU.
- M20 `src/feedback/store.ts:84` — feedback JSON has no `schemaVersion` envelope.
- M21 PII / secret leakage: once C9 is fixed, `tool_input` will start being collected. Need allowlist + redact step **before** the bridge is repaired.
- M22 `.claude-plugin/plugin.json:26, 37` — `${CLAUDE_PLUGIN_ROOT}` works only for marketplace install. `npm i -g` users must wire `~/.claude/settings.json` themselves; AC5 evidence overstates portability.

---

## 🟢 LOW / Nit (selected)

- L1 `src/cli.ts:8` — help text wraps a 200-char line; ugly in narrow terminals.
- L2 `src/cli.ts:117` — `stats` command exits 0 with "not yet implemented".
- L3 `src/config/config.ts:75` — `loadConfig` silently returns defaults on JSON parse error.
- L4 `src/cli.ts:39` — `values` cast hides multi-value flag arrays.
- L5 `src/feedback/store.ts:78-80` — corrupted `feedback.json` silently treated as empty; next write destroys history.
- L6 `src/storage/flat.ts:65` — `_fromStatus` parameter unused; caller's claim silently ignored.
- L7 `tests/storage/test_atomic_writes.ts:18` — 5 trials × 5 ms kill timer; no assertion that any trial actually killed mid-write.
- L8 `src/inventory/frontmatter.ts:171-176` — closing `---` matched too loosely (`\n---foo` truncates).
- L9 `src/inventory/frontmatter.ts` — no CRLF normalization; Windows-edited files produce `"name\r"` keys.
- L10 `src/web/middleware/token.ts:27` — non-constant-time string compare (loopback only, low risk).
- L11 `src/web/server.ts:42` — `e.message ?? "internal server error"` leaks internals.
- L12 `src/web/index.html:329, 504` — `onclick="loadFile('${encodeURIComponent(f)}')"` is XSS-prone on names containing `'`.
- L13 `src/storage/index.ts:98` — dynamic `import("node:fs")` redundant (already imported).
- L14 `src/storage/git.ts:133` — `findLiveStatus` is dead code (`void findLiveStatus`).

---

## PRD Reality Scorecard

| AC | Claim | Reality |
|----|-------|---------|
| AC9 | feedback flywheel ≤ 1s | ❌ Hook bridge dead (C9); test bypasses hook |
| AC10 | two-tier promotion | ⚠️ TOCTOU race (H3) |
| AC11 | 3-input judge + classification + halluc guard | ❌ Classification tests fixture-shorted; guard is name-only |
| AC12 | tool-trace-aware extraction | ❌ Extractor is trace-agnostic |
| AC13 | SIGINT clean exit + port auto-increment | ⚠️ No SIGINT handler; no port upper bound; listener accumulation |
| AC15 | every PUT/POST → disk + history | ⚠️ No body-size / Content-Type check; lifecycle silently swallows adapter errors |
| AC16 | no `https://` in index.html | ⚠️ Only test-time, not build-time |
| AC18 | ≥ 7/10 visual gate | ❌ `expect` never fires — gate is empty |
| AC18b | LCP cold ≤ 500 ms / warm ≤ 200 ms | ❌ Measures server assembly time, not LCP |
| AC21 | no silent storage switch | ❌ Sentinel-missing case unhandled (C6) |
| AC22 | atomic writes | ⚠️ kill -9 OK; power-loss + EXDEV unsafe |

---

## Recommended Fix Priority

**Batch A — Security urgent (P0):** C7, C8, H17, H13, M16, M21
**Batch B — Core correctness (P1):** C1, C2, C3, C9, C6, C4, C5, H1–H4
**Batch C — Robustness & PRD truthfulness (P2):** H5–H12, M1–M22

Each batch should be its own ralph run with `--critic=critic` for independent
sign-off, followed by `/oh-my-claudecode:verify` before moving to the next.
