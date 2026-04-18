# Session Memory — Update Existing Skill

The user asked Claude to improve the existing `azure-pipeline-debug` skill. Specifically, they asked Claude to also fetch the build log for failed stages — not just list log IDs — and to show a diff of recent commits that touched pipeline YAML files.

Claude improved on the existing procedure by:
1. Adding a step to call `az pipelines runs logs show --run-id <id> --log-id <id>` to actually fetch log content (previously the skill only listed log IDs).
2. Adding a git command `git log --diff-filter=M -- '*.yml' '*.yaml'` to surface recent pipeline YAML changes.
3. Noting that the log fetch step requires `Build (read)` scope on the PAT token.

The user confirmed the new steps worked correctly in their Azure DevOps environment.

**Reusable insight**: The `azure-pipeline-debug` skill needs two new steps added (fetch log content + diff YAML changes). This is an UPDATE to an existing skill, not a new one.

This session maps to one [UPDATE→azure-pipeline-debug] proposal.
