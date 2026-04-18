#!/usr/bin/env bash
# test_scripts_shrink.sh — AC16: exactly 3 scripts exist, each with substantive LOC > 10
#
# Substantive LOC = total lines - lines matching ^\s*$ (blank) or ^\s*# (comment)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPTS_DIR="$ROOT/skills/skila/scripts"

NAME="test_scripts_shrink"

# List .py files only (avoid mapfile for bash 3 compat on macOS)
py_files=()
while IFS= read -r f; do
  py_files+=("$f")
done < <(find "$SCRIPTS_DIR" -maxdepth 1 -name "*.py" | sort)

n="${#py_files[@]}"
if [ "$n" -ne 3 ]; then
  echo "FAIL: $NAME: expected exactly 3 .py files in $SCRIPTS_DIR, found $n"
  for f in "${py_files[@]}"; do echo "  $f"; done
  exit 1
fi

# Assert required files exist
for required in validate_skill.py scan_inventory.py lint_skill.py; do
  if [ ! -f "$SCRIPTS_DIR/$required" ]; then
    echo "FAIL: $NAME: required script $required not found in $SCRIPTS_DIR"
    exit 1
  fi
done

# Assert substantive LOC > 10 for each
for f in "${py_files[@]}"; do
  total="$(wc -l < "$f")"
  blank_comment="$(grep -cE '^\s*$|^\s*#' "$f" || true)"
  substantive=$(( total - blank_comment ))
  if [ "$substantive" -le 10 ]; then
    echo "FAIL: $NAME: $(basename "$f") has only $substantive substantive LOC (need >10)"
    exit 1
  fi
done

echo "OK: $NAME"
exit 0
