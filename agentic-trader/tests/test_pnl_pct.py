"""pnl_pct.py -- loss limits measured against starting capital."""
import pytest


def pnl(run_script, daily, weekly, capital=500.0, daily_limit=0.05, weekly_limit=0.10):
    return run_script(
        "pnl_pct.py",
        "--daily-realized-usd", daily,
        "--weekly-realized-usd", weekly,
        "--starting-capital-usd", capital,
        "--daily-limit-pct", daily_limit,
        "--weekly-limit-pct", weekly_limit,
    )


def test_flat_day_does_not_halt(run_script):
    out = pnl(run_script, 0, 0).json()
    assert out["entries_halted"] is False
    assert out["halt_reason"] is None
    assert out["daily_pnl_pct"] == 0.0


def test_gains_never_halt(run_script):
    out = pnl(run_script, 50, 120).json()
    assert out["entries_halted"] is False
    assert out["daily_pnl_pct"] == 0.1


def test_small_loss_within_limits(run_script):
    out = pnl(run_script, -10, -20).json()
    assert out["entries_halted"] is False
    assert out["daily_pnl_pct"] == -0.02
    assert out["weekly_pnl_pct"] == -0.04


def test_daily_breach_halts(run_script):
    out = pnl(run_script, -30, -30).json()
    assert out["entries_halted"] is True
    assert "daily drawdown" in out["halt_reason"]


def test_weekly_breach_halts_on_a_calm_day(run_script):
    out = pnl(run_script, -5, -60).json()
    assert out["entries_halted"] is True
    assert "weekly drawdown" in out["halt_reason"]
    assert "daily drawdown" not in out["halt_reason"]


def test_both_breaches_are_both_reported(run_script):
    out = pnl(run_script, -40, -80).json()
    assert out["entries_halted"] is True
    assert "daily drawdown" in out["halt_reason"]
    assert "weekly drawdown" in out["halt_reason"]


def test_exact_limit_counts_as_a_breach(run_script):
    """The limit is inclusive -- hitting it exactly halts."""
    out = pnl(run_script, -25, 0).json()      # -25/500 = exactly -5%
    assert out["daily_pnl_pct"] == -0.05
    assert out["entries_halted"] is True


def test_a_hair_under_the_limit_does_not_halt(run_script):
    out = pnl(run_script, -24.99, 0).json()
    assert out["entries_halted"] is False


def test_percentages_are_denominated_against_starting_capital(run_script):
    """Not against realized-trade capital, which is a smaller and drifting base."""
    out = pnl(run_script, -100, -100, capital=2000).json()
    assert out["daily_pnl_pct"] == -0.05
    assert out["entries_halted"] is True


# --- failure contract -------------------------------------------------------

def test_zero_starting_capital_is_a_json_error(run_script):
    err = pnl(run_script, -10, -10, capital=0).error()
    assert "starting_capital_usd" in err


def test_negative_starting_capital_is_a_json_error(run_script):
    err = pnl(run_script, -10, -10, capital=-500).error()
    assert "starting_capital_usd" in err


def test_non_positive_limit_is_a_json_error(run_script):
    """A zero limit would halt on any flat day -- almost certainly a config slip."""
    err = pnl(run_script, 0, 0, daily_limit=0).error()
    assert "loss limits" in err
