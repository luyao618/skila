---
name: prose-only-fetch-logs
description: Fetch pipeline logs and grep for error patterns to surface build failures.
---

# prose-only-fetch-logs

This skill describes how to fetch logs and identify errors in CI output.

## Overview

When a build fails, you should fetch the relevant log files and run grep to find error lines.
The fetch operation retrieves log data from the CI system and stores it locally for analysis.

## Steps

1. Identify the build ID.
2. Fetch the log artifact from the CI system.
3. Run grep over the log to find lines containing "error" or "FAILED".
4. Summarize findings.

## Notes

This skill is intentionally prose-only with no sibling `scripts/` directory.
The linter should emit a WARN because the description contains the verb "fetch" (an exec verb)
but there is no accompanying scripts/ directory with automation.

This is a fixture to drive test_lint.sh (AC5).
