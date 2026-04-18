# Session Memory — Multiple Insights

This session produced three distinct reusable insights across different scopes.

## Insight 1: Docker multi-stage build optimization (NEW global)

The user asked Claude to optimize a Dockerfile that was producing 2.1 GB images. Claude applied a multi-stage build pattern: build stage used `python:3.12` to compile wheels, final stage used `python:3.12-slim` and only copied compiled artifacts. Image size dropped to 340 MB. The user had to guide Claude to also add `.dockerignore` with `__pycache__`, `.git`, `tests/` entries. Total: 7 tool calls, 2 user corrections.

**Proposal**: [NEW@global] `docker-multistage-optimize` — Guide for shrinking Python Docker images with multi-stage builds (~45 lines, medium complexity).

## Insight 2: Local git pre-commit hook setup (NEW local)

The user asked Claude to wire up a pre-commit hook in this specific repository to run `ruff check` and `pytest -q --tb=no` before every commit. Claude created `.git/hooks/pre-commit`, made it executable, and tested it with a deliberate failing commit. The hook correctly blocked the commit.

**Proposal**: [NEW@local] `git-precommit-ruff-pytest` — Local hook recipe for this repo's ruff+pytest pre-commit guard (~20 lines, low complexity).

## Insight 3: Azure pipeline debug improvement (UPDATE existing)

The user discovered that the `azure-pipeline-debug` skill was missing a step to correlate failure timestamps with deployment events. Claude added a step using `az monitor activity-log list --start-time <ts>` to surface recent deployments near the failure window.

**Proposal**: [UPDATE→azure-pipeline-debug] Add deployment-correlation step using az monitor activity-log.

---

Summary: three insights — one [NEW@global], one [NEW@local], one [UPDATE→azure-pipeline-debug].
