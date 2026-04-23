# Skila Codebase Exploration Report

**Date:** 2026-04-23  
**Agent:** Explore  
**Scope:** Storage adapter system, distill pipeline, validate/lint system, inventory/scanner, web API file management

---

## 1. Storage Adapter System (`src/storage/`)

### Architecture Overview
The storage adapter system is an **abstraction layer** that supports two implementations:
- **GitBackedStorage** (`git.ts`) — version history via git
- **FlatFileStorage** (`flat.ts`) — versioning via filesystem directories

Both implement the `StorageAdapter` interface (`types.ts`). A **sentinel file** (`.adapter-mode`) at `~/.claude/skila-data/.adapter-mode` determines which adapter is active.

### Key Files & Functions

#### `src/storage/types.ts` (48 lines)
**Core abstraction contract:**
- `StorageAdapter` interface defines:
  - `writeSkill(name, version, content, metadata)` — writes SKILL.md + sidecar atomically, commits to git or snapshot to versions dir
  - `readSkill(name, status)` — reads live SKILL.md from status dir
  - `getVersion(name, version)` — retrieves specific version snapshot
  - `listVersions(name)` — returns all versions for a skill
  - `diff(name, from, to)` — version diff
  - **`writeFile(name, relativePath, content, opts?)`** — NEW: writes supporting files (scripts/, references/, assets/)
  - `moveSkill(name, fromStatus, toStatus)` — lifecycle transitions
- `WriteSkillMetadata` carries: `message`, `status`, optional `sidecar` (SkilaMetadata)
- **Extension point:** `writeFile()` accepts arbitrary `relativePath` with:
  - Path traversal guard (no `..`)
  - Optional git commit message
  - Throws `E_USE_WRITE_SKILL` if attempting to overwrite SKILL.md

#### `src/storage/index.ts` (206 lines)
**Lazy singleton factory + intent recovery:**
- `getAdapter()` — reads sentinel, probes git availability, initializes on first run
- **Pre-mortem safety:** Refuses silent adapter switch (throws `E_ADAPTER_MISMATCH` if sentinel says "git" but `.git/` missing)
- **FIX-H7:** Write-ahead intent log for `moveSkill`:
  - `writeMoveIntent()` — logs intent before move
  - `recoverMoveIntent()` — on adapter init, retries incomplete moves
  - `moveSkillWithIntentLog()` — wrapper that handles intent lifecycle

#### `src/storage/git.ts` (377 lines)
**GitBackedStorage implementation:**
- **Repo layout:**
  ```
  ~/.claude/skila-data/
    .git/
    skills/
      published/<name>/SKILL.md
      draft/<name>/SKILL.md
      staging/<name>/SKILL.md
      archived/<name>/SKILL.md
      disabled/<name>/SKILL.md
  ```
- **Key methods:**
  - `writeSkill()` — atomically writes to repo + commits with tag `[skill=<name> v<version>]`
  - `writeFile()` — writes supporting file to `skills/<status>/<name>/<relativePath>`, commits with message `web-edit <name>/<relativePath>`
  - `getVersion()` — searches git log for version tags, retrieves exact snapshot
  - `diff()` — uses `git diff` with fallback to manual diff if command unavailable
- **Foreign repo guard (FIX-H8):** Checks `.skila-init` marker to ensure repo was created by skila
- **Sidecar handling:** Commits `.skila.json` alongside SKILL.md (line 166-170)
- **Error handling:** Wraps all git calls with timeout (5s), error classification

#### `src/storage/flat.ts` (277 lines)
**FlatFileStorage implementation:**
- **Versioning layout:**
  ```
  ~/.claude/skila-data/
    versions/<name>/
      v<version>/
        SKILL.md
        .meta.json
        .skila.json
  ```
- **Live tree:** Skills live in `~/.claude/skills/{,.draft-skila,.staging-skila,…}` (mirrored to git repo)
- **Key methods:**
  - `writeSkill()` — snapshots to `versions/<name>/v<version>/` + atomically writes live copy
  - `writeFile()` — writes to live skill dir + creates parent dirs as needed (line 140-152)
  - `moveSkill()` — renames skill dir, handles EXDEV (cross-device) with fallback copy
  - `diff()` — uses system `diff` or fallback manual diff
- **Sidecar handling:** Writes `.skila.json` in both version snapshot and live dir

#### `src/storage/atomic.ts` (83 lines)
**Atomic write primitives (used by both adapters):**
- `atomicWriteFileSync(target, data)`:
  - Writes to temp file in same directory (`.{basename}.tmp-{random-hex}`)
  - Fsyncs temp file
  - Atomically renames temp → target via `fs.rename()` (POSIX atomic)
  - Falls back to copy + fsync on EXDEV (cross-device)
  - Fsyncs parent directory after rename to flush metadata
- **Error recovery:** Cleans up temp files on failure
- **Testable:** Exports `_ops` object so tests can mock `renameSync` without ESM spying

#### `src/storage/validate.ts` (29 lines)
**Name & version validation:**
- `NAME_REGEX` — `/^[a-z0-9][a-z0-9._-]*$/` (lowercase alphanumeric + dots/underscores/hyphens, max 64 chars)
- `SEMVER_REGEX` — `/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/` (strict semver with optional pre-release)
- `assertValidName()`, `assertValidVersion()` — throw `StorageAdapterError` on mismatch

### Extension Points for Supporting Files

The storage adapter already supports **subdirectories** via the `writeFile()` API:

```typescript
// Git adapter example:
await adapter.writeFile("my-skill", "scripts/helper.ts", content);
// Writes to: ~/.claude/skila-data/skills/<status>/my-skill/scripts/helper.ts

// Both adapters:
// - Path traversal prevention: throws E_BAD_PATH if relativePath contains ".."
// - SKILL.md protection: throws E_USE_WRITE_SKILL if path ends with SKILL.md
// - Atomic writes via atomicWriteFileSync()
// - Git commits each write (git adapter only)
```

**Supported subdirectories:** No hardcoded list — any `relativePath` works. The API is generic.

---

## 2. Distill Pipeline (`src/distill/`, `src/commands/distill.ts`)

### Pipeline Flow

```
Session Fixture (session.md + tool trace JSON)
         ↓
 extractCandidateFromFixture()
         ↓
 DistillCandidate { name, description, body, toolTrace, sessionId }
         ↓
 callJudge() with inventory
         ↓
 JudgeOutput { decision: "NEW"|"UPDATE", target_name?, similarity, ... }
         ↓
 Hallucination guard (UPDATE→X but X not in inventory)
         ↓
 SkillProposal { name, mode, body, description, changelogEntry, warnings }
         ↓
 Validate + Write to .draft-skila/
         ↓
 DistillResult { proposal, judgeOutput, warnings, draftPath }
```

### Key Files & Functions

#### `src/distill/extractor.ts` (56 lines)
**Candidate extraction (fixture-based):**
- `loadFixtureSession(path)` — reads fixture session.md, locates tool trace:
  - Looks for `tool-trace: trace-<key>` in frontmatter
  - Falls back to `trace-<sessionId>.json` next to fixture
  - Returns `{ sessionText, toolTrace, sessionId }`
- `extractCandidateFromFixture(path)` — parses YAML frontmatter:
  - Extracts `name:` and `description:` from frontmatter
  - Body = everything after frontmatter block
  - Returns **DistillCandidate** with all fields (body is raw session text or isolated section)
- **Data structure available:** Full session markdown + tool trace entries

#### `src/judge/judge.ts` (95 lines)
**Judge caller (mock mode default, live path stubbed for Phase 3):**
- `callJudge({ candidate, inventory })` — orchestrates decision:
  1. Builds judge prompt via `buildJudgePrompt()`
  2. If `JUDGE_LIVE !== "1"` (default):
     - Tries fixture response from `tests/fixtures/judge-responses/<sessionName>.json`
     - Falls back to deterministic heuristic
  3. Live path (Phase 3): returns heuristic if no API key
- **Heuristic logic:** Token-based overlap scoring:
  - Tokenizes candidate (name + description + body)
  - Compares against inventory skill names/descriptions
  - Scores by 4+-char token matches
  - Returns UPDATE if score ≥ 0.4, else NEW
- **Data at this stage:** 
  - Full DistillCandidate (with body text)
  - Inventory of all skills (Skill[])
  - Judge prompt (string)

#### `src/commands/distill.ts` (110 lines)
**Distill orchestrator:**
- `runDistill(opts)` — full pipeline:
  1. Extract candidate from fixture
  2. Scan inventory
  3. Call judge
  4. **Hallucination guards:**
     - UPDATE with empty target_name → downgrade to NEW + warning
     - UPDATE→X but X not in inventory → downgrade to NEW + warning
  5. Build SkillProposal (NEW or UPDATE):
     - NEW: `version = 0.1.0`
     - UPDATE: bump parent version (minor/major/patch)
  6. Build SkillFrontmatter (clean, no skila block):
     ```yaml
     name: <name>
     description: <description>
     compatibility: { node: ">=20" }
     ```
  7. Build SkilaMetadata (sidecar):
     ```json
     {
       "version": "0.1.0",
       "status": "draft",
       "parentVersion": null,
       "revisionCount": 0,
       "lastImprovedAt": "<iso-ts>",
       "changelog": [{ version, date, change }],
       "source": "skila-distill" | "skila-revise"
     }
     ```
  8. Write to `~/.claude/skills/.draft-skila/<name>/SKILL.md` + `.skila.json`
  9. Validate SKILL.md content
- **Dry run mode:** Skips write, returns proposal

### Data Structures at Each Stage

| Stage | Available Data |
|-------|-----------------|
| **Extraction** | Session text, tool trace entries, sessionId |
| **Judge** | DistillCandidate, inventory skills, judge prompt |
| **Validation** | SkillFrontmatter (name, description), SkillProposal |
| **Write** | SKILL.md content, SkilaMetadata (sidecar), version, changelog |

---

## 3. Validate/Lint System (`src/validate/`)

### Validation Layers

#### `src/validate/validate.ts` (61 lines)
**Blocking validator (throws on error):**
- `validateSkillContent(raw, opts)` — validates SKILL.md only:
  - Parses YAML frontmatter
  - Checks `name` (required, matches NAME_REGEX)
  - Checks `description` (required, ≤ 1024 chars)
  - Optional `expectedDirName` — validates name matches parent dir
  - Returns parsed `SkillFrontmatter`
  - Throws `SkilaValidationError` (array of error strings)
- `validateSkilaMetadata(meta)` — validates sidecar JSON:
  - Checks `status` ∈ valid set
  - Checks `version` is semver string
  - Checks `changelog` is array
  - Throws on mismatch

**Does NOT validate:**
- Subdirectory structure (references/, scripts/, assets/)
- Supporting file content
- SKILL.md body content

#### `src/validate/lint.ts` (27 lines)
**Advisory linter (warns, never throws):**
- `lintSkillContent(raw)` — returns array of `LintWarning`:
  - **Rule: `description-too-short`** — if description < 40 chars
  - **Rule: `body-too-short`** — if body < 100 chars
  - **Rule: `parse`** — if YAML parse fails (returns early with parse error)
- **Never validates subdirectories or supporting files**

### Known Limitations

- Lint doesn't know about `references/`, `scripts/`, `assets/` subdirectories
- No validation that subdirectories exist or contain valid files
- No content validation for supporting files

---

## 4. Inventory & Scanner (`src/inventory/`)

### Scanning Pipeline

#### `src/inventory/scanner.ts` (126 lines)
**Filesystem walker:**
- `scanInventory()` — scans all 5 status dirs:
  - Iterates `["draft", "staging", "published", "archived", "disabled"]`
  - Returns `Skill[]` (merged across all statuses)
  - Clears warnings at start
- `scanStatus(status)` — scans single status dir:
  1. Reads `~/.claude/skills/{,.draft-skila,…}/<status>/` directory
  2. For each entry:
     - Follows symlinks (security check: realpath containment)
     - Looks for `SKILL.md` in subdirectory
     - Parses frontmatter + body
     - **Reads sidecar** (`.skila.json`) or legacy in-frontmatter `skila:` block
     - Returns `Skill { name, status, path, frontmatter, body, skila }`
  3. **Does NOT recursively scan** — only first-level subdirectories (one per skill)
- `findSkill(name)` — O(n) search across all statuses
- `inventoryHas(name)` — boolean check

**Scanner behavior:**
- **Symlink support:** Follows symlinks but verifies resolved target is inside expected root
- **Fallback parsing:** If frontmatter parse fails, extracts description from first heading/line
- **Status on disk wins:** Ignores `skila.status` in sidecar; uses actual parent directory status

### Sidecar System (`src/inventory/sidecar.ts`)

#### File location
- Colocated with `SKILL.md`: `<skill-dir>/.skila.json`

#### Structure
```typescript
interface SkilaMetadata {
  version: string;              // e.g. "0.1.0"
  status: SkillStatus;          // "draft" | "staging" | "published" | ...
  parentVersion: string | null;
  revisionCount: number;
  lastImprovedAt: string;       // ISO timestamp
  changelog: SkilaChangelogEntry[];
  source?: "skila-distill" | "skila-revise" | "user-edit-via-web" | "skila-rollback";
}
```

#### Key functions
- `readSidecarIfExists(skillMdPath)` — returns SkilaMetadata or undefined
- `readSidecar(skillMdPath, fallbackStatus)` — returns SkilaMetadata (or defaults)
- `writeSidecar(skillMdPath, meta)` — atomic JSON write
- `bumpAndAppend(meta, change, source?)` — bumps patch version, appends changelog entry
- `serializeSidecar(meta)` — returns JSON string

**Limitations:**
- Doesn't know about supporting file subdirectories (scripts/, references/, assets/)
- No directory structure validation during read
- Changelog entries stored only in sidecar (not tracked per supporting file)

---

## 5. Web API (`src/web/`)

### File Management Endpoints (`src/web/api/files.ts`)

#### GET `/api/skills/:name/file?path=...`
- **Auth:** Requires token (FIX-C7)
- **Security hardening:**
  1. Path normalization + `..` rejection
  2. Symlink rejection at leaf
  3. Realpath containment (both root and leaf must be inside skill dir)
  4. 4 MiB file size cap
  5. Allowlist of text extensions (`.md`, `.ts`, `.json`, `.yaml`, `.sh`, `.py`, etc.)
- **Response:** `{ path, content, mtime }`

#### PUT `/api/skills/:name/file`
- **Auth:** Requires token
- **Request body:** `{ path, content, mtime }`
- **Security:** Same hardening as GET + symlink check for existing files
- **Optimistic concurrency:** Compares `mtime` against disk; returns 409 if mismatch
- **Delegates to storage adapter:** `await adapter.writeFile(name, normalized, content, { message })`
- **Response:** `{ ok: true, path, mtime }`

#### Supported file types (TEXT_EXT_ALLOWLIST)
- Markdown, JSON, YAML, TOML, INI, env
- TypeScript, JavaScript, Python, shell scripts
- CSS, HTML, XML, CSV
- Special: `.gitignore`, `.env` (extensionless)

#### Path handling
- `safeResolve(skillDir, filePath)` — validates & normalizes paths:
  - Rejects `..` after normalization
  - Joins skill dir + normalized path
  - Returns absolute path or error code

---

### Skill Details Endpoint (`src/web/api/skills.ts`)

#### GET `/api/skills/:name`
Returns full skill object **including supporting file inventory:**
```typescript
{
  ...skillSummary,
  body: string,                 // Full SKILL.md content
  scripts: ["scripts/foo.ts"],  // Relative paths to scripts/ subdir
  references: ["references/..."],
  assets: ["assets/..."],
  mtime: string,
  rawContent: string
}
```

**Implementation (lines 69-84):**
```typescript
const dir = dirname(skill.path);
const scripts = listDirFiles(dir, "scripts");    // Lists non-directory files
const references = listDirFiles(dir, "references");
const assets = listDirFiles(dir, "assets");
```

Function `listDirFiles(dir, sub)`:
- Checks if `<dir>/<sub>` exists
- Lists non-directory files only
- Returns `["<sub>/<filename>", ...]`

#### PUT `/api/skills/:name`
- Updates SKILL.md + bumps sidecar version
- Validates frontmatter (`name`, `description` match dir)
- Optimistic concurrency check (mtime)
- Bumps patch version in sidecar
- Appends changelog entry with source `"user-edit-via-web"`
- Delegates to storage adapter

---

### Web Server Routing (`src/web/server.ts`)

#### API Routes
```
GET  /api/skills                          → list all skills
GET  /api/skills/:name                    → full skill details (+ file inventory)
GET  /api/skills/:name/file?path=...      → read supporting file
PUT  /api/skills/:name/file               → write supporting file
PUT  /api/skills/:name                    → update SKILL.md
GET  /api/skills/:name/versions           → version history
GET  /api/skills/:name/diff?from=&to=     → version diff
GET  /api/skills/:name/feedback           → feedback stats
POST /api/skills/:name/feedback           → record feedback
POST /api/skills/:name/{lifecycle}        → promote, graduate, reject, archive, disable, reactivate, rollback
```

#### Security
- **FIX-H17:** Host + Origin validation (loopback only: 127.0.0.1, localhost, ::1)
- **FIX-H13:** Body size cap (1 MiB)
- **Content-Type checks:** JSON-only routes enforce `application/json`
- **Security headers:** CSP, X-Frame-Options, X-Content-Type-Options, CORP, COEP

---

## 6. Configuration & Paths (`src/config/config.ts`)

### Environment Variables
- `SKILA_HOME` — override `~/.claude/skila-data/`
- `SKILA_SKILLS_ROOT` — override `~/.claude/skills/`
- `SKILA_FORCE_ADAPTER=flat` — force flat adapter (test isolation)
- `JUDGE_LIVE=1` — enable live judge (Phase 3)
- `SKILA_JUDGE_FIXTURE=1` — use fixture judge responses
- `SKILA_FIXTURE_ROOT` — custom fixture directory path

### Directory Structure
```
~/.claude/skills/
  (published skills - no prefix)
  .draft-skila/
  .staging-skila/
  .archived-skila/
  .disabled-skila/

~/.claude/skila-data/
  .git/                    (git adapter only)
  .adapter-mode            (sentinel: "git" or "flat")
  .move-intent.json        (transient: intent log)
  .write-probe             (transient: writability check)
  versions/                (flat adapter only)
    <skill-name>/
      v<version>/
        SKILL.md
        .meta.json
        .skila.json
  skills/                  (git adapter only - repo mirror)
    published/<name>/SKILL.md
    draft/<name>/SKILL.md
    staging/<name>/SKILL.md
    archived/<name>/SKILL.md
    disabled/<name>/SKILL.md
```

---

## 7. Summary: Extension Points for Supporting Files

### What Already Works

1. **Storage Adapter API** (`writeFile(name, relativePath, content, opts?)`)
   - Both Git and Flat adapters support arbitrary subdirectories
   - Atomic writes via `atomicWriteFileSync()`
   - Path traversal protection (`..` rejection)
   - Optional git commit message

2. **Web API File Endpoints**
   - GET `/api/skills/:name/file?path=...` (token-gated)
   - PUT `/api/skills/:name/file` (token-gated, optimistic concurrency)
   - Both support subdirectories (scripts/, references/, assets/, custom)
   - Allowlist-based (text files only)
   - Full hardening against path traversal and symlink escapes

3. **Skill Details Endpoint**
   - Lists supporting files in `scripts/`, `references/`, `assets/` subdirs
   - Returns file inventory in `GET /api/skills/:name` response

4. **Storage Structure**
   - Git adapter: `skills/<status>/<name>/<relativePath>` preserved in git history
   - Flat adapter: `versions/<name>/v<version>/<relativePath>` snapshots supporting files

### What Needs Addition

1. **Inventory Scanner**
   - Currently doesn't recurse subdirectories or track supporting files
   - Could be extended to enumerate files, validate subdirectory structure
   - No per-file metadata (e.g., which version introduced a reference)

2. **Validate/Lint**
   - No validation of subdirectory content
   - No lint warnings for missing or malformed supporting files
   - Could check: do all `scripts/` files have executable permissions? Do `references/` match expected formats?

3. **Distill Pipeline**
   - Supporting files not currently extracted from session fixtures
   - Could enhance `DistillCandidate` to include supporting file proposals
   - Judge could suggest file structure (e.g., "create scripts/deploy.sh")

4. **Documentation**
   - No schema documentation for `references/`, `scripts/`, `assets/` subdirectories
   - No conventions for file naming or structure

---

## 8. Code File Locations Quick Reference

| Component | File(s) | Lines |
|-----------|---------|-------|
| Storage types | `src/storage/types.ts` | 48 |
| Storage factory | `src/storage/index.ts` | 206 |
| Git adapter | `src/storage/git.ts` | 377 |
| Flat adapter | `src/storage/flat.ts` | 277 |
| Atomic writes | `src/storage/atomic.ts` | 83 |
| Name validation | `src/storage/validate.ts` | 29 |
| Extraction | `src/distill/extractor.ts` | 56 |
| Judge | `src/judge/judge.ts` | 95 |
| Distill command | `src/commands/distill.ts` | 110 |
| Validate | `src/validate/validate.ts` | 61 |
| Lint | `src/validate/lint.ts` | 27 |
| Scanner | `src/inventory/scanner.ts` | 126 |
| Sidecar | `src/inventory/sidecar.ts` | 89 |
| File API | `src/web/api/files.ts` | 170 |
| Skills API | `src/web/api/skills.ts` | 171 |
| Web server | `src/web/server.ts` | 327 |
| Config | `src/config/config.ts` | 89 |

