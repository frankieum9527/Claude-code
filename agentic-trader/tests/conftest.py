"""Shared harness for the risk-script tests.

The scripts are invoked by the pipeline as subprocesses whose stdout is
parsed as JSON, so that's how they're tested here -- through the real CLI,
not by importing the functions. A test that passed while the CLI contract
was broken would be worse than no test, since the CLI contract is the only
interface PHASE_B_TASK.md actually uses.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = REPO_ROOT / "scripts"


class ScriptResult:
    def __init__(self, completed):
        self.returncode = completed.returncode
        self.stdout = completed.stdout
        self.stderr = completed.stderr

    @property
    def ok(self):
        return self.returncode == 0

    def json(self):
        """Parse stdout as the single JSON object a successful run must emit."""
        assert self.ok, f"script failed (exit {self.returncode}): {self.stderr}"
        assert self.stdout.strip(), "successful run emitted nothing on stdout"
        return json.loads(self.stdout)

    def error(self):
        """Parse stderr as the JSON error object a failed run must emit."""
        assert not self.ok, f"expected failure, but script succeeded: {self.stdout}"
        assert not self.stdout.strip(), (
            f"a failed run must emit nothing on stdout, got: {self.stdout!r}"
        )
        payload = json.loads(self.stderr)
        assert "error" in payload, f"error payload missing 'error' key: {payload}"
        return payload["error"]


@pytest.fixture
def run_script():
    """Run a script in scripts/ with the given args and optional stdin JSON."""

    def _run(name, *args, stdin=None):
        stdin_text = json.dumps(stdin) if stdin is not None else None
        completed = subprocess.run(
            [sys.executable, str(SCRIPTS / name), *[str(a) for a in args]],
            input=stdin_text,
            capture_output=True,
            text=True,
        )
        return ScriptResult(completed)

    return _run


@pytest.fixture
def size_positions(run_script):
    """position_sizing.py with the documented risk_rules.json defaults.

    Any keyword overrides a default; ``extra`` appends bare flags.
    """

    def _run(candidates, extra=(), **overrides):
        opts = {
            "--total-value": 500.0,
            "--cash-start": 500.0,
            "--concurrent-positions-start": 0,
            "--max-position-pct": 0.20,
            "--max-concurrent-positions": 4,
            "--min-cash-buffer-pct": 0.10,
            "--min-top-up-usd": 5.00,
            "--min-top-up-pct-of-target": 0.10,
            "--conviction-pct": "high:0.20,medium:0.12,low:0.06",
        }
        opts.update(overrides)
        args = [x for pair in opts.items() for x in pair]
        return run_script("position_sizing.py", *args, *extra, stdin=candidates)

    return _run


@pytest.fixture
def check_stop(run_script):
    """stop_loss.py with the documented volatility_scaled defaults."""

    def _run(extra=(), **overrides):
        opts = {
            "--mode": "volatility_scaled",
            "--volatility-multiplier": 2.5,
            "--min-stop-pct": 0.05,
            "--max-stop-pct": 0.15,
            "--fallback-stop-pct": 0.07,
            "--hard-stop-pct": 0.07,
        }
        opts.update(overrides)
        args = [x for pair in opts.items() for x in pair]
        return run_script("stop_loss.py", *args, *extra)

    return _run
