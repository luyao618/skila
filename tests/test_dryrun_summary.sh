#!/usr/bin/env bash
# test_dryrun_summary.sh — AC13: --mode summary emits "<N> created, <M> updated, <K> skipped, <L> discarded"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SHIM="$ROOT/tests/bin/skila_dryrun.py"
FIXTURE="$ROOT/tests/fixtures/session-multi.md"

NAME="test_dryrun_summary"

output="$(python3 "$SHIM" --fixture "$FIXTURE" --mode summary)"

# Assert matches: "<N> created, <M> updated, <K> skipped, <L> discarded"
if ! echo "$output" | grep -qE '^[0-9]+ created, [0-9]+ updated, [0-9]+ skipped, [0-9]+ discarded$'; then
  echo "FAIL: $NAME: output does not match expected pattern"
  echo "  got: $output"
  exit 1
fi

echo "OK: $NAME"
exit 0
