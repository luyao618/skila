#!/usr/bin/env bash
# test_validate.sh — AC4: validate_skill.py PASS and FAIL cases
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VALIDATE="$ROOT/skills/skila/scripts/validate_skill.py"
VALID_SKILL="$ROOT/tests/fixtures/skills/global/azure-pipeline-debug/SKILL.md"
BAD_SKILL="$ROOT/tests/fixtures/skills/malformed/bad-skill/SKILL.md"

NAME="test_validate"

# Case 1: valid skill should exit 0
if ! python3 "$VALIDATE" "$VALID_SKILL" >/dev/null 2>&1; then
  echo "FAIL: $NAME: validate_skill.py returned non-zero for valid skill $VALID_SKILL"
  exit 1
fi

# Case 2: malformed skill should exit non-0
if python3 "$VALIDATE" "$BAD_SKILL" >/dev/null 2>&1; then
  echo "FAIL: $NAME: validate_skill.py returned 0 for malformed skill $BAD_SKILL (expected non-zero)"
  exit 1
fi

echo "OK: $NAME"
exit 0
