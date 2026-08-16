#!/usr/bin/env python3
# Part of agentic-trader, adapted from FriesTrader
# (https://github.com/YizhiSong/FriesTrader), Copyright (c) 2026 Yizhi Song,
# MIT License -- see LICENSE and NOTICE.
"""Shared failure/output contract for the risk scripts.

Every script in this directory obeys the same contract, so the caller
never has to distinguish "this script rejected the input" from "this
script crashed":

- Success: exactly one JSON object on stdout, exit 0.
- Failure: exactly one JSON object ``{"error": "..."}`` on stderr, exit 1,
  and nothing on stdout.

That second guarantee is the point. PHASE_B_TASK.md treats any script
failure as a halt condition, so a failure has to be machine-readable
rather than a Python traceback -- the halt should be a decision the
caller can log, not a parse failure it has to interpret.

Stdlib only, like every other script here.
"""
import json
import sys


class RiskInputError(Exception):
    """An input the script can't act on. Reported as a JSON error, not a traceback."""


def fail(message):
    """Print a JSON error object to stderr and exit non-zero."""
    print(json.dumps({"error": str(message)}), file=sys.stderr)
    sys.exit(1)


def emit(obj):
    """Print exactly one JSON object to stdout."""
    print(json.dumps(obj))


def run(main_fn):
    """Invoke ``main_fn``, converting any uncaught error into the JSON error shape.

    Wrapping the broad ``Exception`` is deliberate here. These scripts are
    invoked by an unattended scheduled agent that must never be handed a
    traceback on stdout and left to guess what happened -- a KeyError on a
    malformed candidate and an explicit validation failure should look
    identical to the caller, and both should halt.
    """
    try:
        main_fn()
    except RiskInputError as e:
        fail(e)
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 -- see docstring
        fail(f"{type(e).__name__}: {e}")


def load_stdin_candidates():
    """Read a JSON array of candidate objects from stdin."""
    try:
        candidates = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        raise RiskInputError(f"invalid candidates JSON on stdin: {e}")
    if not isinstance(candidates, list):
        raise RiskInputError(
            f"expected a JSON array of candidates on stdin, got {type(candidates).__name__}"
        )
    return candidates
