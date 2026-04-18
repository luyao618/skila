#!/usr/bin/env bash
# test_dryrun_wave2.sh — AC10: session-update wave2 output validation
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SHIM="$ROOT/tests/bin/skila_dryrun.py"
FIXTURE="$ROOT/tests/fixtures/session-update.md"
INVENTORY="$ROOT/tests/fixtures/skills/global"

NAME="test_dryrun_wave2"

output="$(python3 "$SHIM" --fixture "$FIXTURE" --mode wave2 --inventory "$INVENTORY")"

# Assert JSON parses
echo "$output" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null || {
  echo "FAIL: $NAME: output is not valid JSON"
  exit 1
}

check="$(echo "$output" | python3 -c "
import json, sys
data = json.load(sys.stdin)

errors = []

if data.get('wave') != 2:
    errors.append(f'wave={data.get(\"wave\")} (expected 2)')

labels = [o.get('label','') for o in data.get('options', [])]
for required in ['[Apply patch]', '[Skip]', '[Show full new version]']:
    if required not in labels:
        errors.append(f'missing option: {required}')

diff = data.get('diff', '')
if not diff or len(diff.strip()) == 0:
    errors.append('diff field is empty')

if errors:
    print('ERRORS: ' + '; '.join(errors))
    sys.exit(1)
print('OK')
")"

if [ "$check" != "OK" ]; then
  echo "FAIL: $NAME: $check"
  exit 1
fi

echo "OK: $NAME"
exit 0
