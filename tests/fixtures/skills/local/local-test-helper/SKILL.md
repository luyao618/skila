---
name: local-test-helper
description: Run project test suites locally with coverage, filter by pattern, and triage common failures.
---

# local-test-helper

A local helper skill for running tests in this repository with common options.

## When to use

- You need to run a subset of tests matching a name pattern before pushing.
- You want a coverage report without manually remembering pytest/jest flags.
- A CI test is failing locally and you need a fast triage loop.

## Steps

1. Determine the test framework: check `pyproject.toml`, `package.json`, or `Makefile` for test commands.
2. For Python projects: `python -m pytest tests/ -x -q --tb=short`.
3. To filter by name pattern: `pytest -k "<pattern>"`.
4. To get coverage: `pytest --cov=src --cov-report=term-missing`.
5. For Node/Jest projects: `npx jest --runInBand --verbose`.
6. Filter Jest tests: `npx jest -t "<pattern>"`.
7. On failure, read the full traceback — the last `AssertionError` or `Error` line is usually the root cause.
8. Fix the test or the code, then re-run only the failing test to confirm the fix.
9. Run the full suite once more before pushing.

## Pitfalls

- Always run tests from the repo root unless the framework is configured for subdir execution.
- Virtual environments must be activated before running pytest; `which python` should point inside `.venv`.
- Jest watch mode (`--watch`) does not work in non-TTY environments (CI, subshells).
- Coverage reports are meaningless if the test file itself is included in the coverage path — check `.coveragerc`.

## Notes

This is a local skill for this repository only and should not be promoted to global scope.
