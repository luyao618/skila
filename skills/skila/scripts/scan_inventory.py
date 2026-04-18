#!/usr/bin/env python3
"""scan_inventory.py — Walk skill directories and emit a JSON inventory.

Mirrors hermes agent/skill_commands.py:209-271 (scan_skill_commands) but
without platform-filter or registration side-effects.
Skip logic borrowed from hermes agent/skill_commands.py:231:
  any(part in ('.git', '.github', '.hub') for part in skill_md.parts)
See docs/research/hermes-and-memex-study.md §2.2.

Outputs JSON list to stdout:
  [{"name": "...", "description": "...", "scope": "global"|"local", "path": "..."}]

Exit 0 always. Per-entry failures log WARN to stderr and skip.
"""

import argparse
import json
import os
import sys

_SKIP_PARTS = frozenset((".git", ".github", ".hub"))


def parse_frontmatter(text: str) -> dict:
    """Minimal line-based frontmatter parser — same contract as validate_skill.py."""
    if not text.startswith("---\n"):
        raise ValueError("missing opening '---\\n'")
    rest = text[4:]
    end_idx = rest.find("\n---\n")
    if end_idx == -1:
        raise ValueError("no closing '\\n---\\n' found")
    fm_block = rest[:end_idx]
    data: dict = {}
    for line in fm_block.splitlines():
        if not line or line.startswith(" ") or line.startswith("\t"):
            continue
        if ":" in line:
            key, _, value = line.partition(":")
            data[key.strip()] = value.strip()
    return data


def scan_dir(directory: str, scope: str, results: list) -> None:
    """Scan one skill directory non-recursively; appends to results."""
    abs_dir = os.path.abspath(os.path.expanduser(directory))

    if not os.path.exists(abs_dir):
        print(f"INFO: {scope} dir absent: {abs_dir}", file=sys.stderr)
        return

    try:
        entries = os.listdir(abs_dir)
    except OSError as exc:
        print(f"WARN: {abs_dir}: cannot list directory: {exc}", file=sys.stderr)
        return

    # Filter to candidate skill subdirs (non-dot, non-file)
    skill_dirs = [
        e for e in sorted(entries)
        if not e.startswith(".")
        and e not in _SKIP_PARTS
        and os.path.isdir(os.path.join(abs_dir, e))
    ]

    if not skill_dirs:
        print(f"INFO: {scope} dir empty", file=sys.stderr)
        return

    for entry_name in skill_dirs:
        skill_dir = os.path.join(abs_dir, entry_name)
        skill_md_path = os.path.join(skill_dir, "SKILL.md")

        # Skip if no SKILL.md present
        if not os.path.isfile(skill_md_path):
            continue

        # Guard: skip if any path part is in _SKIP_PARTS (mirrors hermes :231)
        parts = set(skill_md_path.replace("\\", "/").split("/"))
        if parts & _SKIP_PARTS:
            continue

        try:
            with open(skill_md_path, encoding="utf-8") as fh:
                content = fh.read()
            data = parse_frontmatter(content)
        except (OSError, ValueError) as exc:
            print(f"WARN: {skill_md_path}: {exc}", file=sys.stderr)
            continue

        name = data.get("name", entry_name)
        description = data.get("description", "")

        results.append(
            {
                "name": name,
                "description": description,
                "scope": scope,
                "path": skill_md_path,
            }
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scan skill directories and emit JSON inventory."
    )
    parser.add_argument(
        "--global-dir",
        default=os.path.join(os.path.expanduser("~"), ".claude", "skills"),
        help="Global skills directory (default: ~/.claude/skills)",
    )
    parser.add_argument(
        "--local-dir",
        default=os.path.join(os.getcwd(), ".claude", "skills"),
        help="Local skills directory (default: <cwd>/.claude/skills)",
    )
    args = parser.parse_args()

    results: list = []
    scan_dir(args.global_dir, "global", results)
    scan_dir(args.local_dir, "local", results)

    print(json.dumps(results, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()
