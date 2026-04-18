#!/usr/bin/env bash
# test_lint.sh — AC5: lint_skill.py exits 0 and emits status=WARN for prose-only-fetch-logs
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LINT="$ROOT/skills/skila/scripts/lint_skill.py"
FIXTURE="$ROOT/tests/fixtures/skills/prose-only-fetch-logs/SKILL.md"

NAME="test_lint"

# Run lint — must exit 0 (advisory linter never exits non-zero)
output="$(python3 "$LINT" "$FIXTURE")"
exit_code=$?

if [ $exit_code -ne 0 ]; then
  echo "FAIL: $NAME: lint_skill.py exited $exit_code (expected 0)"
  exit 1
fi

# JSON must have status = "WARN"
status="$(echo "$output" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['status'])")"
if [ "$status" != "WARN" ]; then
  echo "FAIL: $NAME: expected status=WARN, got status=$status"
  exit 1
fi

echo "OK: $NAME"
exit 0
