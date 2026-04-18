# Session Memory — Single New Skill

The user asked Claude to set up a Python project from scratch with a virtual environment, install dependencies from a requirements file, configure pytest, and run the test suite with coverage reporting.

Claude executed the following multi-step workflow successfully:
1. Called `python3 -m venv .venv` to create the virtual environment.
2. Called `source .venv/bin/activate && pip install -r requirements.txt` to install dependencies.
3. Ran `pip install pytest pytest-cov` to add test tooling.
4. Created `pyproject.toml` with `[tool.pytest.ini_options]` section.
5. Ran `pytest --cov=src --cov-report=term-missing -q` — all 14 tests passed.

The user had to correct Claude once: the initial `pip install` failed because the virtual environment was not activated. After activation, everything succeeded.

**Reusable insight**: Python project bootstrap (venv + deps + pytest + coverage) is a common multi-step workflow that benefits from crystallization as a global skill. Estimated ~50 lines of guidance.

This session maps to one [NEW@global] proposal: `python-project-bootstrap`.
