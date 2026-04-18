#!/usr/bin/env bash
# test_scan.sh — AC8: scan_inventory.py finds azure-pipeline-debug with scope=global
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCAN="$ROOT/skills/skila/scripts/scan_inventory.py"
GLOBAL_DIR="$ROOT/tests/fixtures/skills/global"
LOCAL_DIR="$ROOT/tests/fixtures/skills/local"

NAME="test_scan"

output="$(python3 "$SCAN" --global-dir "$GLOBAL_DIR" --local-dir "$LOCAL_DIR")"

# Assert JSON parses and contains azure-pipeline-debug with scope=global
result="$(echo "$output" | python3 -c "
import json, sys
data = json.load(sys.stdin)
matches = [e for e in data if e.get('name') == 'azure-pipeline-debug' and e.get('scope') == 'global']
if not matches:
    print('NOT_FOUND')
    sys.exit(1)
print('FOUND')
")"

if [ "$result" != "FOUND" ]; then
  echo "FAIL: $NAME: azure-pipeline-debug with scope=global not found in scan output"
  echo "  output was: $output"
  exit 1
fi

echo "OK: $NAME"
exit 0
