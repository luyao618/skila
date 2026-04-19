---
name: azure-pipeline-debug
description: Improved Azure pipeline debugging with new transient-vs-deterministic heuristic
tool-trace: trace-azure
---
# Session 2 — extension to azure-pipeline-debug

Refined how we classify pipeline failures. New heuristic: if the failing step
ran for <30s and the log mentions `connection refused` we treat it as transient
and retry once before opening an investigation.
