#!/usr/bin/env bash
# run_all.sh — Run all test_*.sh scripts and report results
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pass=0
fail=0
failed_tests=()

# Deterministic order
for test_script in \
  "$SCRIPT_DIR/test_validate.sh" \
  "$SCRIPT_DIR/test_lint.sh" \
  "$SCRIPT_DIR/test_scan.sh" \
  "$SCRIPT_DIR/test_dryrun_empty.sh" \
  "$SCRIPT_DIR/test_dryrun_wave1.sh" \
  "$SCRIPT_DIR/test_dryrun_wave2.sh" \
  "$SCRIPT_DIR/test_dryrun_summary.sh" \
  "$SCRIPT_DIR/test_atomic_rename.sh" \
  "$SCRIPT_DIR/test_scripts_shrink.sh" \
  "$SCRIPT_DIR/test_research_coverage.sh"; do

  if [ ! -f "$test_script" ]; then
    echo "MISSING: $test_script"
    (( fail++ )) || true
    failed_tests+=("$test_script (missing)")
    continue
  fi

  if bash "$test_script"; then
    (( pass++ )) || true
  else
    (( fail++ )) || true
    failed_tests+=("$(basename "$test_script")")
  fi
done

echo ""
echo "==============================="
echo "Results: $pass passed, $fail failed"
echo "==============================="

if [ ${#failed_tests[@]} -gt 0 ]; then
  echo "Failed tests:"
  for t in "${failed_tests[@]}"; do
    echo "  - $t"
  done
  exit 1
fi

exit 0
