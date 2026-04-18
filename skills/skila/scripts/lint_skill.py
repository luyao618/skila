#!/usr/bin/env python3
"""lint_skill.py — ADVISORY heuristic linter for skila SKILL.md files.

Always exits 0 — warnings never block a write (R17, AC5).
See docs/research/hermes-and-memex-study.md §2.1 (lint posture is a skila
DIVERGE: hermes has no advisory lint; skila introduces it as advisory-only).

Outputs JSON to stdout:
  {"status": "PASS"|"WARN", "reasons": ["..."]}
"""

import json
import os
import re
import sys

# Heuristic: action verbs that imply executable / deterministic behaviour
_EXEC_VERBS_RE = re.compile(
    r'\b(run|fetch|scan|grep|build|invoke|execute|generate|deploy|query|parse)\b',
    re.IGNORECASE,
)

# Heuristic: structural-knowledge words that imply a references/ dir
_REFERENCE_WORDS_RE = re.compile(
    r'\b(table|schema|spec|reference)\b',
    re.IGNORECASE,
)

# Heuristic: output-artifact words that imply an assets/ dir
_ASSET_WORDS_RE = re.compile(
    r'\b(report|template|config|output)\b',
    re.IGNORECASE,
)

MIN_BODY_LINES = 20


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Minimal frontmatter splitter — mirrors validate_skill.py."""
    if not text.startswith("---\n"):
        return {}, text
    rest = text[4:]
    end_idx = rest.find("\n---\n")
    if end_idx == -1:
        return {}, text
    fm_block = rest[:end_idx]
    body = rest[end_idx + 5:]
    data: dict = {}
    for line in fm_block.splitlines():
        if not line or line.startswith(" ") or line.startswith("\t"):
            continue
        if ":" in line:
            key, _, value = line.partition(":")
            data[key.strip()] = value.strip()
    return data, body


def _dir_has_files(dirpath: str) -> bool:
    """Return True if dirpath exists and contains at least one file."""
    if not os.path.isdir(dirpath):
        return False
    for entry in os.listdir(dirpath):
        if os.path.isfile(os.path.join(dirpath, entry)):
            return True
    return False


def main() -> None:
    # Advisory: never exit non-zero except on internal Python error.
    # This is a hard requirement (R17, AC5).

    if len(sys.argv) != 2:
        result = {"status": "WARN", "reasons": [f"Usage: {sys.argv[0]} <path-to-SKILL.md>"]}
        print(json.dumps(result))
        sys.exit(0)

    skill_path = sys.argv[1]

    if not os.path.isfile(skill_path):
        result = {"status": "WARN", "reasons": [f"file not found: {skill_path}"]}
        print(json.dumps(result))
        sys.exit(0)

    try:
        with open(skill_path, encoding="utf-8") as fh:
            content = fh.read()
    except OSError as exc:
        result = {"status": "WARN", "reasons": [f"cannot read file: {exc}"]}
        print(json.dumps(result))
        sys.exit(0)

    data, body = parse_frontmatter(content)
    description = str(data.get("description", ""))
    skill_dir = os.path.dirname(os.path.abspath(skill_path))

    reasons: list[str] = []

    # Heuristic 1: exec-verb in description but no scripts/ sibling with files
    if _EXEC_VERBS_RE.search(description):
        scripts_dir = os.path.join(skill_dir, "scripts")
        if not _dir_has_files(scripts_dir):
            reasons.append(
                "description implies executable behavior "
                f"(matched: {_EXEC_VERBS_RE.search(description).group()!r}) "
                "but no sibling scripts/ dir with files found"
            )

    # Heuristic 2: structural-knowledge words but no references/ sibling
    if _REFERENCE_WORDS_RE.search(description):
        refs_dir = os.path.join(skill_dir, "references")
        if not _dir_has_files(refs_dir):
            reasons.append(
                "description mentions structural knowledge "
                f"(matched: {_REFERENCE_WORDS_RE.search(description).group()!r}) "
                "but no sibling references/ dir with files found"
            )

    # Heuristic 3: output-artifact words but no assets/ sibling
    if _ASSET_WORDS_RE.search(description):
        assets_dir = os.path.join(skill_dir, "assets")
        if not _dir_has_files(assets_dir):
            reasons.append(
                "description mentions output artifacts "
                f"(matched: {_ASSET_WORDS_RE.search(description).group()!r}) "
                "but no sibling assets/ dir with files found"
            )

    # Heuristic 4: body too thin
    body_lines = [ln for ln in body.splitlines() if ln.strip()]
    if len(body_lines) < MIN_BODY_LINES:
        reasons.append(
            f"body has only {len(body_lines)} non-empty lines "
            f"(minimum {MIN_BODY_LINES} recommended)"
        )

    status = "WARN" if reasons else "PASS"
    print(json.dumps({"status": status, "reasons": reasons}))
    sys.exit(0)  # ALWAYS exit 0 — this is a hard requirement


if __name__ == "__main__":
    main()
