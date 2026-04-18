#!/usr/bin/env bash
# test_atomic_rename.sh — AC12: atomic rename via write-to-tmp then mv
set -euo pipefail

NAME="test_atomic_rename"

TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

SRC_CONTENT="# Test SKILL.md content for atomic rename test"
TMP_FILE="$TMPDIR_BASE/dest.tmp"
DEST_FILE="$TMPDIR_BASE/dest"

# Write content to .tmp file (simulating the inline write recipe)
printf '%s\n' "$SRC_CONTENT" > "$TMP_FILE"

# Atomic rename
mv "$TMP_FILE" "$DEST_FILE"

# Assert .tmp is gone
if [ -f "$TMP_FILE" ]; then
  echo "FAIL: $NAME: dest.tmp still exists after mv"
  exit 1
fi

# Assert dest exists
if [ ! -f "$DEST_FILE" ]; then
  echo "FAIL: $NAME: dest file does not exist after mv"
  exit 1
fi

# Assert content equals source
actual="$(cat "$DEST_FILE")"
if [ "$actual" != "$SRC_CONTENT" ]; then
  echo "FAIL: $NAME: dest content does not match source"
  echo "  expected: $SRC_CONTENT"
  echo "  got:      $actual"
  exit 1
fi

echo "OK: $NAME"
exit 0
