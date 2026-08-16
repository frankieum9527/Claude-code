"""stop_loss.py -- reference price, stop_pct, and the trigger decision."""
import statistics

import pytest

# 20 closes with a deliberately small, steady wiggle: stdev is low enough that
# 2.5 * stdev lands under min_stop_pct, exercising the lower clamp.
CALM_CLOSES = ",".join(str(100 + (i % 2) * 0.1) for i in range(20))
# Alternating +/-10% swings: 2.5 * stdev blows past max_stop_pct.
WILD_CLOSES = ",".join(str(100 * (1.1 ** (i % 2))) for i in range(20))


def test_fixed_mode_triggers_at_the_hard_stop(check_stop):
    out = check_stop(**{"--mode": "fixed", "--average-cost": 100, "--current-price": 93}).json()
    assert out["stop_reference_basis"] == "average_cost"
    assert out["stop_pct_used"] == 0.07
    assert out["drawdown_pct"] == 0.07
    assert out["triggered"] is True
    assert out["action"] == "sell_full_position"


def test_fixed_mode_holds_above_the_stop(check_stop):
    out = check_stop(**{"--mode": "fixed", "--average-cost": 100, "--current-price": 95}).json()
    assert out["triggered"] is False
    assert out["action"] == "hold_monitor"


def test_fixed_mode_reports_stop_pct_even_on_a_gain(check_stop):
    out = check_stop(**{"--mode": "fixed", "--average-cost": 100, "--current-price": 130}).json()
    assert out["stop_pct_used"] == 0.07
    assert out["drawdown_pct"] < 0
    assert out["triggered"] is False


def test_volatility_mode_skips_the_computation_on_a_gain(check_stop):
    out = check_stop(**{"--average-cost": 100, "--current-price": 130}).json()
    assert out["stop_pct_used"] is None
    assert out["notes"] == "gain, stop not computed"
    assert out["triggered"] is False


def test_volatility_mode_scales_the_stop_off_realised_stdev(check_stop):
    closes = [100, 102, 99, 103, 101, 104, 100, 105, 102, 106,
              103, 107, 104, 108, 105, 109, 106, 110, 107, 111]
    returns = [(closes[i] - closes[i - 1]) / closes[i - 1] for i in range(1, len(closes))]
    expected = 2.5 * statistics.stdev(returns)
    assert 0.05 < expected < 0.15, "fixture should land inside the clamp to be meaningful"

    out = check_stop(**{"--average-cost": 100, "--current-price": 90,
                        "--daily-closes": ",".join(str(c) for c in closes)}).json()
    assert out["stop_pct_used"] == pytest.approx(round(expected, 6))
    assert out["stdev_20d"] == pytest.approx(round(statistics.stdev(returns), 6))
    assert out["triggered"] is True     # 10% drawdown clears the scaled stop


def test_quiet_symbol_is_clamped_up_to_min_stop_pct(check_stop):
    out = check_stop(**{"--average-cost": 100, "--current-price": 97,
                        "--daily-closes": CALM_CLOSES}).json()
    assert out["stop_pct_used"] == 0.05
    assert out["triggered"] is False    # 3% drawdown, 5% floor


def test_volatile_symbol_is_clamped_down_to_max_stop_pct(check_stop):
    out = check_stop(**{"--average-cost": 100, "--current-price": 88,
                        "--daily-closes": WILD_CLOSES}).json()
    assert out["stop_pct_used"] == 0.15
    assert out["triggered"] is False    # 12% drawdown, 15% ceiling


def test_too_few_bars_falls_back(check_stop):
    out = check_stop(**{"--average-cost": 100, "--current-price": 90,
                        "--daily-closes": "100,101,99,102,98"}).json()
    assert out["stop_pct_used"] == 0.07
    assert "below the 10 minimum" in out["fallback_reason"]
    assert out["triggered"] is True


def test_no_bars_at_all_falls_back(check_stop):
    out = check_stop(**{"--average-cost": 100, "--current-price": 90}).json()
    assert out["stop_pct_used"] == 0.07
    assert "0 usable bars" in out["fallback_reason"]


# --- trailing high after a take-profit tier --------------------------------

def test_trailing_high_becomes_the_reference_once_a_tier_has_fired(check_stop):
    """After trimming, the stop protects the run-up, not the original cost."""
    out = check_stop(
        extra=["--take-profit-tier-fired", "--daily-highs", "110,125,140,138",
               "--trailing-high-since", "2026-06-01"],
        **{"--average-cost": 100, "--current-price": 120, "--daily-closes": CALM_CLOSES},
    ).json()
    assert out["stop_reference_basis"] == "trailing_high"
    assert out["stop_reference_price"] == 140.0
    assert out["drawdown_pct"] == pytest.approx(round((140 - 120) / 140, 6))
    assert out["trailing_high_since"] == "2026-06-01"
    assert out["triggered"] is True     # ~14.3% off the high, 5% clamped stop


def test_current_price_can_itself_be_the_trailing_high(check_stop):
    out = check_stop(
        extra=["--take-profit-tier-fired", "--daily-highs", "110,125"],
        **{"--average-cost": 100, "--current-price": 150},
    ).json()
    assert out["stop_reference_price"] == 150.0
    assert out["drawdown_pct"] == 0.0
    assert out["triggered"] is False


def test_position_still_in_profit_can_still_stop_out_on_the_trailing_high(check_stop):
    """The whole point of trailing: up 15% on cost, but 20% off the high."""
    out = check_stop(
        extra=["--take-profit-tier-fired", "--daily-highs", "100,144"],
        **{"--average-cost": 100, "--current-price": 115, "--daily-closes": CALM_CLOSES},
    ).json()
    assert out["drawdown_pct"] > 0.15
    assert out["triggered"] is True


# --- failure contract -------------------------------------------------------

def test_fixed_mode_without_hard_stop_is_a_json_error(run_script):
    err = run_script("stop_loss.py", "--average-cost", 100, "--current-price", 90,
                      "--mode", "fixed").error()
    assert "--hard-stop-pct" in err


def test_volatility_mode_missing_params_is_a_json_error(run_script):
    err = run_script("stop_loss.py", "--average-cost", 100, "--current-price", 90,
                      "--mode", "volatility_scaled").error()
    assert "--volatility-multiplier" in err


def test_tier_fired_without_highs_is_a_json_error(check_stop):
    err = check_stop(extra=["--take-profit-tier-fired"],
                      **{"--average-cost": 100, "--current-price": 90}).error()
    assert "--daily-highs" in err


def test_inverted_clamp_is_a_json_error(check_stop):
    err = check_stop(**{"--average-cost": 100, "--current-price": 90,
                        "--min-stop-pct": 0.20, "--max-stop-pct": 0.10}).error()
    assert "clamp would invert" in err


def test_non_positive_average_cost_is_a_json_error(check_stop):
    err = check_stop(**{"--average-cost": 0, "--current-price": 90}).error()
    assert "average-cost" in err


def test_non_numeric_closes_is_a_json_error(check_stop):
    err = check_stop(**{"--average-cost": 100, "--current-price": 90,
                        "--daily-closes": "100,oops,102"}).error()
    assert "comma-separated list of numbers" in err
