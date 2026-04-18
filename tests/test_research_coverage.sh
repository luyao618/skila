#!/usr/bin/env bash
# test_research_coverage.sh — AC2: hermes-and-memex-study.md contains required path tokens and anchors
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESEARCH_DOC="$ROOT/docs/research/hermes-and-memex-study.md"

NAME="test_research_coverage"

if [ ! -f "$RESEARCH_DOC" ]; then
  echo "FAIL: $NAME: research doc not found: $RESEARCH_DOC"
  exit 1
fi

# Required Phase-0 path tokens
declare -a REQUIRED_TOKENS=(
  "tools/skill_manager_tool.py"
  "memex-retro/SKILL.md"
  ".claude-plugin/plugin.json"
  "src/commands/write.ts"
  "src/lib/store.ts"
  "hooks/hooks.json"
)

for token in "${REQUIRED_TOKENS[@]}"; do
  if ! grep -qF "$token" "$RESEARCH_DOC"; then
    echo "FAIL: $NAME: required path token not found in research doc: $token"
    exit 1
  fi
done

# Assert at least 20 anchors matching [a-zA-Z_./]+\.(py|ts|md|json):[0-9]+
anchor_count="$(grep -oE '[a-zA-Z0-9_./-]+\.(py|ts|md|json):[0-9]+' "$RESEARCH_DOC" | wc -l | tr -d ' ')"
if [ "$anchor_count" -lt 20 ]; then
  echo "FAIL: $NAME: expected >=20 file:line anchors, found $anchor_count"
  exit 1
fi

echo "OK: $NAME"
exit 0
