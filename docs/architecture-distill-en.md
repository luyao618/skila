# Skila Distill: Skill Generation & Update Pipeline

> Entry point: `/skila` in Claude Code, or `skila distill --from-fixture <session.md>` from terminal

## Unified Flow

```mermaid
flowchart TD
    %% ── Entry ──
    START["/skila or skila distill"] --> PARSE["Parse Session + Tool Trace
    → DistillCandidate"]
    PARSE --> SCAN["Scan existing skill inventory
    (draft/staging/published/archived/disabled)"]

    %% ── Phase A: Rule-based extraction ──
    PARSE --> EXTRACT

    subgraph PHASE_A ["Phase A · Rule-Based Extraction"]
        EXTRACT["Extract candidate files from tool trace"]
        EXTRACT --> BA["Repeated/complex Bash commands
        → scripts/*.sh"]
        EXTRACT --> RD["Read .md/.txt/.json/.yaml
        → references/*"]
        EXTRACT --> WR["Write .html/.tmpl/.svg
        → assets/*"]
        BA & RD & WR --> CANDS["Candidate list
        each with confidence score"]
    end

    %% ── Phase B: Judge review ──
    SCAN --> JUDGE
    CANDS --> JUDGE

    subgraph PHASE_B ["Phase B · LLM Judge"]
        JUDGE{"API Key available?"}
        JUDGE -->|Yes| LLM["Claude API
        review candidates + fill gaps
        classify keep/remove/modify"]
        JUDGE -->|No| HEUR["Heuristic fallback
        name similarity matching"]
        LLM & HEUR --> DECISION
    end

    DECISION{"NEW or UPDATE?"}

    %% ── Hallucination guard ──
    DECISION -->|"UPDATE
    empty target"| REJECT["❌ Rejected
    warning: empty target"]
    DECISION -->|"UPDATE
    target not found"| DOWNGRADE["⚠️ Downgraded to NEW
    warning: hallucination"]
    DECISION -->|"UPDATE
    target exists ✓"| UPDATE_PATH
    DECISION -->|"NEW"| NEW_PATH
    DOWNGRADE --> NEW_PATH

    %% ── Build proposal ──
    subgraph BUILD ["Build Proposal"]
        NEW_PATH["NEW Proposal
        version = 0.1.0"]
        UPDATE_PATH["UPDATE Proposal
        bumpVersion(patch/minor/major)"]
    end

    NEW_PATH --> MERGE
    UPDATE_PATH --> MERGE

    MERGE["Merge supporting files
    Judge results take priority
    fallback: rule candidates with confidence ≥ 0.6"]

    MERGE --> DRY{"dry-run?"}
    DRY -->|Yes| DRY_OUT["Return proposal JSON
    nothing written to disk"]

    %% ── Phase C: Write ──
    DRY -->|No| WRITE

    subgraph PHASE_C ["Phase C · Write + Validate"]
        WRITE["SKILL.md
        frontmatter + body
        + ## Bundled Resources references"]
        WRITE --> SIDECAR[".skila.json
        version / status / changelog"]
        SIDECAR --> VALIDATE["Validate SKILL.md
        ≤500 lines / spec compliance"]
        VALIDATE --> FILES["Write supporting files
        scripts/ references/ assets/
        (path safety checks)"]
    end

    FILES --> DONE

    %% ── Output ──
    subgraph OUTPUT ["Generated Output"]
        DONE["✅ .draft-skila/skill-name/"]
        DONE --- TREE["SKILL.md
        .skila.json
        scripts/*.sh
        references/*.md
        assets/*.html"]
    end

    %% ── Lifecycle ──
    DONE --> LIFECYCLE

    subgraph LIFECYCLE ["Skill Lifecycle"]
        direction LR
        D2["draft"] -->|promote| S2["staging"]
        S2 -->|graduate| P2["published"]
        S2 -->|reject| D2
        P2 -->|archive| A2["archived"]
        P2 -->|disable| DIS2["disabled"]
        A2 -->|reactivate| P2
        DIS2 -->|reactivate| P2
    end

    %% ── Styling ──
    style PHASE_A fill:#1a1a2e,stroke:#16213e,color:#e0e0e0
    style PHASE_B fill:#1a1a2e,stroke:#16213e,color:#e0e0e0
    style PHASE_C fill:#1a1a2e,stroke:#16213e,color:#e0e0e0
    style OUTPUT fill:#0f3460,stroke:#16213e,color:#e0e0e0
    style LIFECYCLE fill:#1a1a2e,stroke:#533483,color:#e0e0e0
    style REJECT fill:#800020,stroke:#800020,color:#fff
    style DOWNGRADE fill:#b8860b,stroke:#b8860b,color:#fff
    style DONE fill:#2e7d32,stroke:#2e7d32,color:#fff
    style DRY_OUT fill:#37474f,stroke:#37474f,color:#fff
```

## Key Design Decisions

| Mechanism | Description |
|---|---|
| **Two-phase extraction** | Phase A uses rules to quickly extract candidates from tool traces; Phase B uses LLM to review, filter, and supplement |
| **Hallucination guard** | Judge says UPDATE but target is empty → reject; target doesn't exist → downgrade to NEW |
| **Path safety** | Pre-write validation: reject `..`, absolute paths, invalid subdirectories; realpath check prevents symlink escape |
| **Progressive disclosure** | Layer 1 metadata always in context → Layer 2 body loaded on trigger → Layer 3 bundled resources loaded on demand |
| **Graceful degradation** | No Claude API key → automatic fallback to heuristic judge, no functionality loss |
| **Supporting file classification** | `scripts/` deterministic executable code · `references/` on-demand context docs · `assets/` output templates (never loaded into context) |
