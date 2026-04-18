#!/usr/bin/env python3
"""skila_dryrun.py — Deterministic dry-run shim for skila tests.

Does NOT invoke any LLM. Reads fixture markdown filenames and emits
canned AskUserQuestion-shaped JSON based on a deterministic mapping table.

CLI:
  python3 tests/bin/skila_dryrun.py --fixture <path> [--inventory <path>]
                                     [--mode wave1|wave2|empty|summary]

Exit 0 always (unless argparse fails on bad flags).
"""

import argparse
import json
import os
import sys

# ---------------------------------------------------------------------------
# Deterministic fixture → output mapping
# ---------------------------------------------------------------------------

WAVE1_EMPTY = "no skill worth crystallizing"

WAVE1_SINGLE_NEW = {
    "wave": 1,
    "kind": "AskUserQuestion",
    "multiSelect": True,
    "question": "Select skills to crystallize from this session:",
    "options": [
        {
            "label": "[NEW@global] python-project-bootstrap — Bootstrap Python venv, deps, and pytest with coverage (~50 lines, medium)",
            "description": "Create new global skill: python-project-bootstrap",
        }
    ],
}

WAVE1_UPDATE = {
    "wave": 1,
    "kind": "AskUserQuestion",
    "multiSelect": True,
    "question": "Select skills to crystallize from this session:",
    "options": [
        {
            "label": "[UPDATE→azure-pipeline-debug] Add steps to fetch build log content and diff recent pipeline YAML changes (~35 lines, low)",
            "description": "Update existing skill: azure-pipeline-debug",
        }
    ],
}

WAVE2_UPDATE = {
    "wave": 2,
    "kind": "AskUserQuestion",
    "multiSelect": False,
    "question": "Review the proposed patch for azure-pipeline-debug:",
    "diff": (
        "--- a/azure-pipeline-debug/SKILL.md\n"
        "+++ b/azure-pipeline-debug/SKILL.md\n"
        "@@ -8,6 +8,12 @@ Diagnose and fix failing Azure DevOps CI/CD pipelines end-to-end.\n"
        " 4. Fetch the specific failed step log: `az pipelines runs logs show --run-id <run-id> --log-id <log-id>`.\n"
        " 5. Search log output for patterns: `error:`, `FAILED`, `exit code`, `Exception`, `fatal`.\n"
        "-6. Cross-reference the failure timestamp with recent commits: `git log --since=\"<timestamp>\"`.\n"
        "+6. Fetch full log content and save locally: `az pipelines runs logs show ... > stage.log`.\n"
        "+7. Diff recent pipeline YAML changes: `git log --diff-filter=M -- '*.yml' '*.yaml'`.\n"
        "+8. Correlate failure timestamp with deployment events:\n"
        "+   `az monitor activity-log list --start-time <ts> --resource-group <rg>`.\n"
        "+9. Cross-reference the failure timestamp with recent commits: `git log --since=\"<timestamp>\"`.\n"
    ),
    "options": [
        {
            "label": "[Apply patch]",
            "description": "Apply the diff and write the updated SKILL.md",
        },
        {
            "label": "[Skip]",
            "description": "Skip this update for now",
        },
        {
            "label": "[Show full new version]",
            "description": "Show the complete proposed SKILL.md before deciding",
        },
    ],
}

WAVE1_MULTI = {
    "wave": 1,
    "kind": "AskUserQuestion",
    "multiSelect": True,
    "question": "Select skills to crystallize from this session:",
    "options": [
        {
            "label": "[NEW@global] docker-multistage-optimize — Shrink Python Docker images with multi-stage builds and .dockerignore (~45 lines, medium)",
            "description": "Create new global skill: docker-multistage-optimize",
        },
        {
            "label": "[NEW@local] git-precommit-ruff-pytest — Local pre-commit hook recipe: ruff check + pytest guard (~20 lines, low)",
            "description": "Create new local skill: git-precommit-ruff-pytest",
        },
        {
            "label": "[UPDATE→azure-pipeline-debug] Add deployment-correlation step using az monitor activity-log (~35 lines, low)",
            "description": "Update existing skill: azure-pipeline-debug",
        },
    ],
}

WAVE1_GARBAGE = {
    "wave": 1,
    "kind": "AskUserQuestion",
    "multiSelect": True,
    "question": "Select skills to crystallize from this session:",
    "options": [
        {
            "label": "[NEW@global] fetch-logs-grep — Fetch CI logs and grep for errors (WARN: shallow pattern, low reuse value)",
            "description": "Create new global skill — but quality is borderline (WARN: only 2 tool calls, no error recovery)",
        }
    ],
}


def _fixture_key(fixture_path: str) -> str:
    """Return the basename without extension of the fixture file."""
    return os.path.splitext(os.path.basename(fixture_path))[0]


def _inventory_has_skill(inventory_dir: str, skill_name: str) -> bool:
    """Check if a skill name exists as a subdirectory in the inventory dir."""
    if not inventory_dir:
        return False
    candidate = os.path.join(inventory_dir, skill_name)
    return os.path.isdir(candidate)


def _count_summary(wave1_json: dict) -> str:
    """Derive a summary line from a wave1 JSON block."""
    options = wave1_json.get("options", [])
    created = sum(1 for o in options if "[NEW@" in o.get("label", ""))
    updated = sum(1 for o in options if "[UPDATE→" in o.get("label", ""))
    skipped = 0
    discarded = 0
    return f"{created} created, {updated} updated, {skipped} skipped, {discarded} discarded"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Skila dry-run shim — deterministic fixture-based output for tests."
    )
    parser.add_argument(
        "--fixture",
        required=True,
        help="Path to a session fixture markdown file.",
    )
    parser.add_argument(
        "--inventory",
        default="",
        help="Path to a skills inventory directory (used for UPDATE lookups).",
    )
    parser.add_argument(
        "--mode",
        choices=["wave1", "wave2", "empty", "summary"],
        default="wave1",
        help="Output mode: wave1 (default), wave2, empty, or summary.",
    )
    args = parser.parse_args()

    key = _fixture_key(args.fixture)
    mode = args.mode

    # -----------------------------------------------------------------------
    # empty / session-empty
    # -----------------------------------------------------------------------
    if key == "session-empty" or mode == "empty":
        print(WAVE1_EMPTY)
        sys.exit(0)

    # -----------------------------------------------------------------------
    # Determine base wave1 block for this fixture
    # -----------------------------------------------------------------------
    if key == "session-single-new":
        wave1_block = WAVE1_SINGLE_NEW
    elif key == "session-update":
        wave1_block = WAVE1_UPDATE
    elif key == "session-multi":
        wave1_block = WAVE1_MULTI
    elif key == "session-garbage":
        wave1_block = WAVE1_GARBAGE
    else:
        # Unknown fixture: emit empty wave1 with zero options
        wave1_block = {
            "wave": 1,
            "kind": "AskUserQuestion",
            "multiSelect": True,
            "question": "Select skills to crystallize from this session:",
            "options": [],
        }

    # -----------------------------------------------------------------------
    # summary mode — derive counts from wave1 block
    # -----------------------------------------------------------------------
    if mode == "summary":
        print(_count_summary(wave1_block))
        sys.exit(0)

    # -----------------------------------------------------------------------
    # wave2 mode — only meaningful for session-update
    # -----------------------------------------------------------------------
    if mode == "wave2":
        if key == "session-update":
            print(json.dumps(WAVE2_UPDATE, indent=2))
        else:
            # For other fixtures, fall back to wave1 (wave2 not applicable)
            print(json.dumps(wave1_block, indent=2))
        sys.exit(0)

    # -----------------------------------------------------------------------
    # wave1 (default)
    # -----------------------------------------------------------------------
    print(json.dumps(wave1_block, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()
