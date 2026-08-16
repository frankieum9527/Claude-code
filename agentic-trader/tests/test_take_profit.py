"""take_profit.py -- tiered partial exits, keyed on stable tier ids."""
import pytest

TIERS = "tp1:0.15:0.25,tp2:0.30:0.25,tp3:0.50:0.25"


def tp(run_script, *args, **kwargs):
    return run_script("take_profit.py", *args, **kwargs)


def test_no_tier_reached_holds(run_script):
    out = tp(run_script, "--average-cost", 100, "--current-price", 110,
             "--quantity", 10, "--tiers", TIERS).json()
    assert out["triggered"] is False
    assert out["action"] == "hold_monitor"
    assert out["fired_this_cycle"] == []
    assert [t["fired"] for t in out["tiers_status"]] == [False, False, False]


def test_first_tier_fires_on_its_fraction(run_script):
    out = tp(run_script, "--average-cost", 100, "--current-price", 120,
             "--quantity", 10, "--tiers", TIERS).json()
    assert out["triggered"] is True
    assert out["action"] == "sell_partial_position"
    assert len(out["fired_this_cycle"]) == 1
    fired = out["fired_this_cycle"][0]
    assert fired["tier_id"] == "tp1"
    assert fired["quantity_before"] == 10.0
    assert fired["quantity_sold"] == 2.5


def test_gap_up_cascades_through_multiple_tiers_in_one_cycle(run_script):
    """A gap past several unfired tiers sells each against the *remaining* quantity."""
    out = tp(run_script, "--average-cost", 100, "--current-price", 160,
             "--quantity", 10, "--tiers", TIERS).json()
    fired = out["fired_this_cycle"]
    assert [f["tier_id"] for f in fired] == ["tp1", "tp2", "tp3"]
    # 10 -> sell 2.5 -> 7.5 -> sell 1.875 -> 5.625 -> sell 1.40625
    assert [f["quantity_before"] for f in fired] == [10.0, 7.5, 5.625]
    assert [f["quantity_sold"] for f in fired] == [2.5, 1.875, 1.40625]
    assert sum(f["quantity_sold"] for f in fired) == pytest.approx(5.78125)


def test_already_fired_tier_is_skipped(run_script):
    out = tp(run_script, "--average-cost", 100, "--current-price", 120,
             "--quantity", 7.5, "--tiers", TIERS, "--already-fired", "tp1").json()
    assert out["triggered"] is False
    assert out["tiers_status"][0] == {"tier_id": "tp1", "gain_pct": 0.15, "fired": True}


def test_already_fired_tier_survives_a_retune_of_its_gain_pct(run_script):
    """Regression: retuning a fired tier must not resurrect it mid-holding-period.

    Fired state used to be keyed on the tier's gain_pct, so editing
    take_profit.tiers in risk_rules.json (0.15 -> 0.18) made tp1 look
    unfired against a position still held, firing it a second time and
    selling another 25% of that position for no reason.
    """
    retuned = "tp1:0.18:0.25,tp2:0.30:0.25,tp3:0.50:0.25"
    out = tp(run_script, "--average-cost", 100, "--current-price", 120,
             "--quantity", 7.5, "--tiers", retuned, "--already-fired", "tp1").json()
    assert out["triggered"] is False, "retuning a fired tier re-fired it"
    assert out["fired_this_cycle"] == []


def test_retuning_an_unfired_tier_still_takes_effect(run_script):
    """The flip side: an *unfired* tier must honour its new threshold immediately."""
    retuned = "tp1:0.10:0.25,tp2:0.30:0.25,tp3:0.50:0.25"
    out = tp(run_script, "--average-cost", 100, "--current-price", 112,
             "--quantity", 10, "--tiers", retuned).json()
    assert [f["tier_id"] for f in out["fired_this_cycle"]] == ["tp1"]


def test_exact_tier_threshold_fires(run_script):
    out = tp(run_script, "--average-cost", 100, "--current-price", 115,
             "--quantity", 10, "--tiers", TIERS).json()
    assert [f["tier_id"] for f in out["fired_this_cycle"]] == ["tp1"]


def test_all_tiers_fired_holds_remainder(run_script):
    out = tp(run_script, "--average-cost", 100, "--current-price", 200,
             "--quantity", 4.2, "--tiers", TIERS,
             "--already-fired", "tp1,tp2,tp3").json()
    assert out["triggered"] is False
    assert all(t["fired"] for t in out["tiers_status"])


def test_tiers_evaluated_in_ascending_order_regardless_of_input_order(run_script):
    shuffled = "tp3:0.50:0.25,tp1:0.15:0.25,tp2:0.30:0.25"
    out = tp(run_script, "--average-cost", 100, "--current-price", 160,
             "--quantity", 10, "--tiers", shuffled).json()
    assert [f["tier_id"] for f in out["fired_this_cycle"]] == ["tp1", "tp2", "tp3"]


def test_loss_fires_nothing(run_script):
    out = tp(run_script, "--average-cost", 100, "--current-price", 80,
             "--quantity", 10, "--tiers", TIERS).json()
    assert out["gain_pct"] == -0.2
    assert out["triggered"] is False


# --- failure contract -------------------------------------------------------

def test_unknown_already_fired_id_is_a_json_error(run_script):
    """A renamed/removed tier id means fired state can't be resolved -- halt, don't guess."""
    err = tp(run_script, "--average-cost", 100, "--current-price", 120,
             "--quantity", 10, "--tiers", TIERS, "--already-fired", "tp_gone").error()
    assert "tp_gone" in err


def test_duplicate_tier_id_is_a_json_error(run_script):
    err = tp(run_script, "--average-cost", 100, "--current-price", 120, "--quantity", 10,
             "--tiers", "tp1:0.15:0.25,tp1:0.30:0.25").error()
    assert "duplicate" in err.lower()


def test_malformed_tier_is_a_json_error(run_script):
    err = tp(run_script, "--average-cost", 100, "--current-price", 120,
             "--quantity", 10, "--tiers", "0.15:0.25").error()
    assert "id:gain_pct:sell_fraction" in err


def test_zero_average_cost_is_a_json_error(run_script):
    err = tp(run_script, "--average-cost", 0, "--current-price", 120,
             "--quantity", 10, "--tiers", TIERS).error()
    assert "average_cost" in err


def test_sell_fraction_above_one_is_a_json_error(run_script):
    err = tp(run_script, "--average-cost", 100, "--current-price", 120, "--quantity", 10,
             "--tiers", "tp1:0.15:1.5").error()
    assert "sell_fraction" in err
