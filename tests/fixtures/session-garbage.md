# Session Memory — Low Quality / Garbage

The user asked Claude to fetch some logs and run grep on them. Claude ran `az pipelines runs logs list --run-id 12345` and then piped the output through `grep error`. Found some error lines. Done.

No multi-step complexity, no error recovery, no user correction, no novel pattern. The fetch-and-grep workflow is trivial and not worth crystallizing as a skill.

This session should trigger a WARN in the distillation output because the pattern is too shallow: it is just "fetch logs and run grep" with no reusable depth.
