"""position_sizing.py -- new-entry sizing, top-ups, and the compounding caps."""
import pytest


def new(symbol, conviction="high"):
    return {"symbol": symbol, "group": "new", "conviction": conviction}


def held(symbol, value, conviction="high"):
    return {"symbol": symbol, "group": "held", "conviction": conviction,
            "current_position_value": value}


# --- new entries ------------------------------------------------------------

def test_new_entry_sized_off_conviction_tier(size_positions):
    out = size_positions([new("AAA", "medium")]).json()
    r = out["results"][0]
    assert r["passed"] is True
    assert r["dollar_amount"] == 60.00          # 0.12 * 500
    assert r["concurrent_positions_after"] == 1
    assert r["cash_remaining_after"] == 440.00
    assert out["cash_remaining_final"] == 440.00


def test_cash_buffer_blocks_an_entry_that_would_breach_it(size_positions):
    out = size_positions([new("AAA")], **{"--cash-start": 105}).json()
    r = out["results"][0]
    assert r["passed"] is False
    assert "min_cash_buffer_pct" in r["reason"]
    assert out["cash_remaining_final"] == 105.00, "a rejected entry must not spend cash"


def test_concurrency_cap_rejects_with_scarcity_wording(size_positions):
    out = size_positions([new("AAA")], **{"--concurrent-positions-start": 4}).json()
    r = out["results"][0]
    assert r["passed"] is False
    assert "max_concurrent_positions" in r["reason"]
    assert "cap filled by" in r["reason"]


def test_cash_compounds_down_the_ranked_list(size_positions):
    """Later candidates are measured against the cash earlier ones already spent.

    $260 cash, $50 buffer, $100 per high-conviction entry: the third is
    rejected only because the first two spent the room, not on its own merits.
    """
    out = size_positions([new("AAA"), new("BBB"), new("CCC")],
                          **{"--cash-start": 260}).json()
    results = out["results"]
    assert [r["passed"] for r in results] == [True, True, False]
    assert results[0]["cash_remaining_after"] == 160.00
    assert results[1]["cash_remaining_after"] == 60.00
    assert "min_cash_buffer_pct" in results[2]["reason"]
    assert out["cash_remaining_final"] == 60.00
    assert out["concurrent_positions_after_final"] == 2


def test_slots_run_out_mid_list(size_positions):
    out = size_positions(
        [new("AAA", "low"), new("BBB", "low"), new("CCC", "low")],
        **{"--concurrent-positions-start": 2, "--max-concurrent-positions": 3},
    ).json()
    assert [r["passed"] for r in out["results"]] == [True, False, False]
    assert out["concurrent_positions_after_final"] == 3


def test_entries_halted_rejects_everything_and_moves_no_totals(size_positions):
    out = size_positions(
        [new("AAA"), held("BBB", 20)], extra=["--entries-halted"],
    ).json()
    assert all(r["passed"] is False for r in out["results"])
    assert all("loss limit halt" in r["reason"] for r in out["results"])
    assert out["cash_remaining_final"] == 500.00
    assert out["concurrent_positions_after_final"] == 0
    assert out["results"][1]["position_action"] == "top_up"


# --- top-ups ----------------------------------------------------------------

def test_top_up_fills_headroom_to_target(size_positions):
    out = size_positions([held("AAA", 40, "medium")]).json()
    r = out["results"][0]
    assert r["passed"] is True
    assert r["position_action"] == "top_up"
    assert r["target_size"] == 60.00            # 0.12 * 500
    assert r["headroom"] == 20.00
    assert r["dollar_amount"] == 20.00


def test_top_up_does_not_consume_a_slot(size_positions):
    out = size_positions([held("AAA", 40, "medium")],
                          **{"--concurrent-positions-start": 4}).json()
    assert out["results"][0]["passed"] is True
    assert out["concurrent_positions_after_final"] == 4


def test_position_at_target_gets_no_top_up(size_positions):
    out = size_positions([held("AAA", 60, "medium")]).json()
    r = out["results"][0]
    assert r["passed"] is False
    assert "already at or above target size" in r["reason"]


def test_dust_sized_top_up_is_skipped(size_positions):
    """Below max($1, min_top_up_usd, 10% of target) the order isn't worth placing."""
    out = size_positions([held("AAA", 57, "medium")]).json()
    r = out["results"][0]
    assert r["passed"] is False
    assert "below the min top-up threshold" in r["reason"]
    assert r["headroom"] == 3.00                # under the $6 (10% of $60) floor


def test_top_up_clipped_by_the_hard_position_ceiling(size_positions):
    """conviction target may exceed max_position_pct only via ceiling_room clipping."""
    out = size_positions([held("AAA", 90, "high")],
                          **{"--max-position-pct": 0.20}).json()
    r = out["results"][0]
    # target 100, ceiling 100 -> headroom 10, ceiling_room 10 -> top up 10
    assert r["passed"] is True
    assert r["dollar_amount"] == 10.00


def test_top_up_respects_the_cash_buffer(size_positions):
    out = size_positions([held("AAA", 20, "medium")], **{"--cash-start": 55}).json()
    r = out["results"][0]
    assert r["passed"] is False
    assert "min_cash_buffer_pct" in r["reason"]
    assert r["position_action"] == "top_up"


# --- config validation ------------------------------------------------------

def test_conviction_tier_above_the_cap_fails_the_whole_cycle(size_positions):
    """The cap must be a real backstop, not a per-candidate check that never fires."""
    err = size_positions(
        [new("AAA")],
        **{"--conviction-pct": "high:0.35,medium:0.12,low:0.06", "--max-position-pct": 0.20},
    ).error()
    assert "max_position_pct_of_account" in err
    assert "high=" in err


def test_tier_exactly_at_the_cap_is_allowed(size_positions):
    out = size_positions([new("AAA", "high")], **{"--max-position-pct": 0.20}).json()
    assert out["results"][0]["passed"] is True
    assert out["results"][0]["dollar_amount"] == 100.00


def test_unknown_conviction_is_a_json_error_not_a_traceback(size_positions):
    """Regression: this used to exit with a raw KeyError traceback on stdout."""
    err = size_positions([new("AAA", "very_high")]).error()
    assert "very_high" in err
    assert "Traceback" not in err


def test_unknown_group_is_a_json_error(size_positions):
    err = size_positions([{"symbol": "AAA", "group": "sideways", "conviction": "high"}]).error()
    assert "sideways" in err


def test_held_candidate_without_position_value_is_a_json_error(size_positions):
    err = size_positions([{"symbol": "AAA", "group": "held", "conviction": "high"}]).error()
    assert "current_position_value" in err


def test_missing_required_field_is_a_json_error(size_positions):
    err = size_positions([{"symbol": "AAA", "group": "new"}]).error()
    assert "conviction" in err


def test_non_positive_total_value_is_a_json_error(size_positions):
    err = size_positions([new("AAA")], **{"--total-value": 0}).error()
    assert "total-value" in err


def test_malformed_stdin_is_a_json_error(run_script):
    result = run_script(
        "position_sizing.py",
        "--total-value", 500, "--cash-start", 500, "--concurrent-positions-start", 0,
        "--max-position-pct", 0.20, "--max-concurrent-positions", 4,
        "--min-cash-buffer-pct", 0.10, "--min-top-up-usd", 5, "--min-top-up-pct-of-target", 0.10,
        "--conviction-pct", "high:0.20",
    )
    # no stdin at all -> empty input is not a JSON array
    assert result.returncode == 1
    assert "error" in result.stderr


def test_empty_candidate_list_is_a_clean_no_op(size_positions):
    out = size_positions([]).json()
    assert out["results"] == []
    assert out["cash_remaining_final"] == 500.00
