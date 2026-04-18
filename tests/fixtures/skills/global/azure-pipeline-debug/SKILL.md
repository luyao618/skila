---
name: azure-pipeline-debug
description: Debug failing Azure DevOps pipelines by fetching logs, inspecting stages, and diagnosing root-cause errors.
---

# azure-pipeline-debug

Diagnose and fix failing Azure DevOps CI/CD pipelines end-to-end.

## When to use

- A pipeline run fails and you need to identify the root cause quickly.
- Build logs are long and you need to surface only the failing steps.
- You want to correlate stage failures with recent code or config changes.

## Steps

1. Identify the failing pipeline run ID from the Azure DevOps URL or CLI output.
2. Run `az pipelines runs show --id <run-id>` to get overall status and stage breakdown.
3. For each failed stage, run `az pipelines runs logs list --run-id <run-id>` to list log IDs.
4. Fetch the specific failed step log: `az pipelines runs logs show --run-id <run-id> --log-id <log-id>`.
5. Search log output for patterns: `error:`, `FAILED`, `exit code`, `Exception`, `fatal`.
6. Cross-reference the failure timestamp with recent commits: `git log --since="<timestamp>"`.
7. Check pipeline YAML for any recent variable, trigger, or step changes.
8. If the failure is transient (network, timeout), retry the specific stage with `az pipelines runs stage --id <run-id> --stage-id <stage>`.
9. If the failure is a broken dependency, open an issue or PR with the fix.
10. Re-run the pipeline and confirm green status.

## Pitfalls

- Classic pipelines use a different log endpoint than YAML pipelines — always check pipeline type first.
- Log IDs are not stable across retries; always re-list after a rerun.
- Some organizations restrict `az pipelines` scope; you may need a PAT with `Build (read and execute)` scope.
- Stage names with spaces must be URL-encoded or quoted when passed to CLI flags.

## References

- Azure DevOps REST API: https://learn.microsoft.com/en-us/rest/api/azure/devops/
- az pipelines CLI reference: https://learn.microsoft.com/en-us/cli/azure/pipelines
