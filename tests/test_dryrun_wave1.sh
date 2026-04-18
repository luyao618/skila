#!/usr/bin/env bash
# test_dryrun_wave1.sh — AC6, AC9, AC11: session-multi wave1 output validation
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SHIM="$ROOT/tests/bin/skila_dryrun.py"
FIXTURE="$ROOT/tests/fixtures/session-multi.md"

NAME="test_dryrun_wave1"

output="$(python3 "$SHIM" --fixture "$FIXTURE" --mode wave1)"

# Assert JSON parses
echo "$output" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null || {
  echo "FAIL: $NAME: output is not valid JSON"
  exit 1
}

# Assert wave=1
wave="$(echo "$output" | python3 -c "import json,sys; print(json.load(sys.stdin)['wave'])")"
if [ "$wave" != "1" ]; then
  echo "FAIL: $NAME: expected wave=1, got wave=$wave"
  exit 1
fi

# Assert multiSelect=true
multi="$(echo "$output" | python3 -c "import json,sys; print(json.load(sys.stdin)['multiSelect'])")"
if [ "$multi" != "True" ]; then
  echo "FAIL: $NAME: expected multiSelect=True, got $multi"
  exit 1
fi

# Assert >=3 options
n_options="$(echo "$output" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['options']))")"
if [ "$n_options" -lt 3 ]; then
  echo "FAIL: $NAME: expected >=3 options, got $n_options"
  exit 1
fi

# AC9: assert labels contain [NEW@global], [NEW@local], [UPDATE→
check="$(echo "$output" | python3 -c "
import json, sys
data = json.load(sys.stdin)
labels = [o['label'] for o in data['options']]
all_labels = '\n'.join(labels)
missing = []
if '[NEW@global]' not in all_labels:
    missing.append('[NEW@global]')
if '[NEW@local]' not in all_labels:
    missing.append('[NEW@local]')
if '[UPDATE\u2192' not in all_labels:
    missing.append('[UPDATE\u2192')
if missing:
    print('MISSING: ' + ', '.join(missing))
    sys.exit(1)
print('OK')
")"
if [ "$check" != "OK" ]; then
  echo "FAIL: $NAME: missing label variants: $check"
  exit 1
fi

# AC11: assert no AskUserQuestion whose options-set equals exactly {"global","local"} (no spurious scope question)
scope_check="$(echo "$output" | python3 -c "
import json, sys
data = json.load(sys.stdin)
# Check that options labels are not purely 'global' and 'local'
if data.get('kind') == 'AskUserQuestion':
    option_labels = {o.get('label','').strip() for o in data.get('options',[])}
    if option_labels == {'global', 'local'}:
        print('SCOPE_QUESTION_FOUND')
        sys.exit(1)
print('OK')
")"
if [ "$scope_check" != "OK" ]; then
  echo "FAIL: $NAME: AC11: spurious scope-selection question detected"
  exit 1
fi

echo "OK: $NAME"
exit 0
