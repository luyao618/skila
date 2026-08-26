# Security

## Reporting a vulnerability

Open a [security advisory](https://github.com/luyao618/skila/security/advisories/new)
rather than a public issue. Include a reproduction and the affected version.

## Threat model

skila serves a local web UI (default `127.0.0.1:7777`) that reads and writes
skill files under `~/.claude/skills/`. The API is authenticated with an HttpOnly
cookie that the browser attaches automatically, so **any script executing on the
UI's origin inherits full authenticated access to the write and lifecycle APIs**.
Same-origin script execution is therefore the primary risk, not a cosmetic one.

Skill content is not trusted input: SKILL.md files can be authored by an LLM,
imported from a marketplace, or edited by hand.

### Markdown rendering

The preview pane renders SKILL.md through `marked`, which does **not** sanitize
its output — the `sanitize` option was removed in marked v1.0.0. All rendered
Markdown passes through DOMPurify with an explicit allowlist
(`PURIFY_CFG` in `src/web/index.html`) before reaching `innerHTML`. `style` is
excluded from the allowed attributes.

Sanitization is applied to the *output HTML*, never to the Markdown source:
Markdown passes raw HTML through verbatim, so sanitizing the input would both
mangle legitimate syntax and miss the passed-through HTML.

### Content-Security-Policy

`script-src` allows only `'self'` plus a sha256 hash of the inline application
script. The hash is computed at build time by `scripts/postbuild.mjs` from the
final `dist/web/index.html` — the exact bytes the browser executes — and written
to `dist/web/csp-hashes.json`, which ships inside the npm tarball.

The policy **fails closed**: if that manifest is missing, unparseable, or
contains a malformed hash, the server logs a diagnostic and serves
`script-src 'self'` alone. It never falls back to `'unsafe-inline'`. The
practical effect is a visibly broken page rather than a silently weakened one.

Two build gates prevent drift:

- `npm run build` fails if any inline event handler (`onclick=` etc.) appears in
  the built HTML, since those would require `'unsafe-hashes'`.
- CI fails if the committed `dist/` does not match a fresh build, which also
  catches a stale CSP hash.

**Known limitation:** `style-src` still carries `'unsafe-inline'`. CSP hashes
cannot authorize `style="..."` *attributes* (only `'unsafe-inline'` or
`'unsafe-hashes'` can), the markup contains 18 of them, and ECharts injects
styles at runtime. Script execution remains fully gated by `script-src`, so the
residual exposure is CSS-only. Removing it requires moving those attributes into
the stylesheet and assessing ECharts' runtime style injection — tracked as
YAO-349.

### Browser-backed regression gate

`tests/web/test_phase1_browser_gate.ts` drives the real UI in headless Chromium
against the real server and the built `dist/web/index.html`. It is the authority
for the sanitizer contract, because it executes the page's own `safeMarkdown()`
rather than re-implementing the pipeline. It asserts that:

- the sha256 CSP actually authorizes the inline module (the app boots),
- both `innerHTML` sinks — the Preview tab and the live-update listener fired by
  typing into the editor — strip hostile markup,
- no payload executes and no CSP violation or page error is raised,
- and a missing manifest fails closed: `script-src 'self'` with no `unsafe-*`,
  and the app does not boot.

Run it with `npm run test:browser-gate` (requires
`npx playwright install chromium`). CI runs it as a dedicated job with
`SKILA_BROWSER_GATE=1`, which makes a missing browser a hard failure instead of
a silent skip.

The jsdom tests in `tests/web/test_phase1_xss_csp.ts` remain as a fast
pre-filter; they extract the real `PURIFY_CFG` from `index.html`, but only the
browser gate proves the production path.

## Bundled vendor code

Several packages are declared as `devDependencies` but are **bundled by esbuild
into `dist/web/vendor/` at build time**, so they ship to users inside the npm
tarball and the Claude Code plugin:

| Package | Ships in |
|---|---|
| `echarts` | `dist/web/vendor/echarts.js` |
| `marked` | `dist/web/vendor/cm.js` |
| `dompurify` | `dist/web/vendor/cm.js` |
| `@codemirror/state`, `@codemirror/view`, `@codemirror/lang-markdown` | `dist/web/vendor/cm.js` |

`npm audit --omit=dev` **cannot see these** — it inspects the dependency tree,
not the bundle, and these are dev-scoped. That is a structural blind spot.

Run `npm run audit:vendor` (also run in CI) to audit exactly this set and report
what actually ships. It is advisory by default; `npm run audit:vendor -- --strict`
exits non-zero on any advisory.

When adding a package that gets bundled into `dist/web/vendor/`, add it to
`BUNDLED` in `scripts/vendor-audit.mjs`.

### Current known advisory

`echarts` is affected by
[GHSA-fgmj-fm8m-jvvx](https://github.com/advisories/GHSA-fgmj-fm8m-jvvx) (XSS,
moderate, fixed in 6.1.0). It is **not reachable in skila's usage**: the
vulnerability requires a `lines` series with a tooltip and no custom
`tooltip.formatter`, where `series.data[i].name` carries attacker-controlled
HTML. `src/web/index.html` uses only `bar`, `line`, and `pie` series and defines
explicit formatters. This assessment is a snapshot of current usage — adding a
`lines` chart would make it reachable. Upgrading to ECharts 6.x is a breaking
change tracked separately.
