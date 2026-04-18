#!/usr/bin/env python3
"""validate_skill.py — BLOCKING frontmatter validator for skila SKILL.md files.

Borrowed from hermes tools/skill_manager_tool.py:150-186 (_validate_frontmatter),
tools/skill_manager_tool.py:101 (VALID_NAME_RE, MAX_NAME_LENGTH=64),
tools/skill_manager_tool.py:97 (MAX_SKILL_CONTENT_CHARS=100_000),
and memex src/lib/store.ts:119-125 (assertSafePath resolve+startsWith idiom).
See docs/research/hermes-and-memex-study.md §2.1 and §3.4.

Exit codes: 0 = PASS, 1 = FAIL (structured stderr), 2 = environment error.
"""

import re
import sys
import os

# Borrowed from hermes tools/skill_manager_tool.py:101 and :83
VALID_NAME_RE = re.compile(r'^[a-z0-9][a-z0-9._-]*$')
MAX_NAME_LENGTH = 64
MAX_DESCRIPTION_CHARS = 1024
MAX_BODY_LINES = 500
MAX_SKILL_CONTENT_CHARS = 100_000  # borrowed from hermes tools/skill_manager_tool.py:97


def fail(field: str, reason: str) -> None:
    print(f"VALIDATE_FAIL: {field}: {reason}", file=sys.stderr)
    sys.exit(1)


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Minimal line-based YAML frontmatter splitter (no PyYAML).

    Expects file to start with '---\\n', finds closing '---\\n',
    returns (dict of top-level key:value pairs, body string).
    """
    if not text.startswith("---\n"):
        fail("frontmatter", "file must start with '---\\n'")
    rest = text[4:]
    end_idx = rest.find("\n---\n")
    if end_idx == -1:
        fail("frontmatter", "no closing '\\n---\\n' found")
    fm_block = rest[:end_idx]
    body = rest[end_idx + 5:]  # skip '\n---\n'
    data: dict = {}
    for line in fm_block.splitlines():
        if not line or line.startswith(" ") or line.startswith("\t"):
            continue  # skip indented / continuation lines
        if ":" in line:
            key, _, value = line.partition(":")
            data[key.strip()] = value.strip()
    return data, body


def main() -> None:
    if sys.version_info < (3, 9):
        print(
            f"validate_skill.py requires Python >= 3.9; got {sys.version}",
            file=sys.stderr,
        )
        sys.exit(2)

    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <path-to-SKILL.md>", file=sys.stderr)
        sys.exit(2)

    skill_path = sys.argv[1]

    if not os.path.exists(skill_path):
        fail("file", f"path does not exist: {skill_path}")

    if not os.access(skill_path, os.R_OK):
        fail("file", f"file is not readable: {skill_path}")

    try:
        with open(skill_path, encoding="utf-8") as fh:
            content = fh.read()
    except OSError as exc:
        fail("file", f"could not read file: {exc}")

    # Total char ceiling — belt-and-suspenders from hermes §2.1
    if len(content) > MAX_SKILL_CONTENT_CHARS:
        fail(
            "file_size",
            f"file exceeds {MAX_SKILL_CONTENT_CHARS} chars (got {len(content)})",
        )

    # Structural frontmatter checks
    if not content.startswith("---\n"):
        fail("frontmatter", "file must start with '---\\n'")

    data, body = parse_frontmatter(content)

    # Required keys — borrowed from hermes tools/skill_manager_tool.py:175-180
    if "name" not in data:
        fail("name", "frontmatter must include 'name' field")
    if "description" not in data:
        fail("description", "frontmatter must include 'description' field")

    name_val = data["name"]
    desc_val = data["description"]

    # Name regex — borrowed from hermes VALID_NAME_RE and MAX_NAME_LENGTH
    if not VALID_NAME_RE.match(name_val):
        fail(
            "name",
            f"value {name_val!r} does not match ^[a-z0-9][a-z0-9._-]*$",
        )
    if len(name_val) > MAX_NAME_LENGTH:
        fail("name", f"exceeds {MAX_NAME_LENGTH} chars (got {len(name_val)})")

    # name must equal parent directory basename
    parent_dir = os.path.basename(os.path.dirname(os.path.abspath(skill_path)))
    if name_val != parent_dir:
        fail(
            "name",
            f"value {name_val!r} does not match parent directory {parent_dir!r}",
        )

    # Description length cap — borrowed from hermes MAX_DESCRIPTION_LENGTH=1024
    if len(str(desc_val)) > MAX_DESCRIPTION_CHARS:
        fail(
            "description",
            f"exceeds {MAX_DESCRIPTION_CHARS} chars (got {len(str(desc_val))})",
        )

    # Body line count
    body_lines = body.splitlines()
    if len(body_lines) > MAX_BODY_LINES:
        fail(
            "body",
            f"exceeds {MAX_BODY_LINES} lines (got {len(body_lines)})",
        )

    print(f"VALIDATE_PASS: {skill_path}")
    sys.exit(0)


if __name__ == "__main__":
    main()
