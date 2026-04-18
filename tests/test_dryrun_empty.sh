#!/usr/bin/env bash
# test_dryrun_empty.sh — AC7: empty session → "no skill worth crystallizing"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SHIM="$ROOT/tests/bin/skila_dryrun.py"
FIXTURE="$ROOT/tests/fixtures/session-empty.md"

NAME="test_dryrun_empty"

output="$(python3 "$SHIM" --fixture "$FIXTURE")"

if [ "$output" != "no skill worth crystallizing" ]; then
  echo "FAIL: $NAME: expected exactly 'no skill worth crystallizing', got: $output"
  exit 1
fi

echo "OK: $NAME"
exit 0
