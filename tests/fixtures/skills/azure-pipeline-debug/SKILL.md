---
name: azure-pipeline-debug
description: Debug Azure pipeline build failures by inspecting logs, identifying transient vs deterministic failures, and proposing fixes.
compatibility:
  node: ">=20"
skila:
  version: 0.1.0
  status: published
  parentVersion: null
  revisionCount: 0
  lastImprovedAt: "2026-04-19T00:00:00Z"
  changelog:
    - { version: 0.1.0, date: "2026-04-19T00:00:00Z", change: "Initial draft from session session-1" }
  source: skila-distill
---
# azure-pipeline-debug

When an Azure pipeline build fails, inspect the build log via `pipelines_get_build_log_by_id`,
classify the failure as transient (retry) or deterministic (file fix), and propose targeted
edits to the failing yaml.
