"""rank_candidates.py -- the priority order new entries and top-ups compete on."""


def rank(run_script, candidates):
    return run_script("rank_candidates.py", stdin=candidates)


def symbols(out):
    return [c["symbol"] for c in out]


def c(symbol, conviction, risk_flags=..., pct=...):
    """Build a candidate; pass nothing for risk_flags/pct to omit the key entirely."""
    out = {"symbol": symbol, "conviction": conviction}
    if risk_flags is not ...:
        out["risk_flags"] = risk_flags
    if pct is not ...:
        out["pct_below_52wk_high"] = pct
    return out


def test_conviction_tier_dominates(run_script):
    out = rank(run_script, [
        c("LOW", "low", [], 0.9),
        c("MED", "medium", [], 0.9),
        c("HIGH", "high", [], 0.0),
    ]).json()
    assert symbols(out) == ["HIGH", "MED", "LOW"]


def test_fewer_risk_flags_wins_within_a_tier(run_script):
    out = rank(run_script, [
        c("THREE", "high", ["a", "b", "c"], 0.5),
        c("NONE", "high", [], 0.5),
        c("ONE", "high", ["a"], 0.5),
    ]).json()
    assert symbols(out) == ["NONE", "ONE", "THREE"]


def test_omitted_risk_flags_sorts_last_in_its_tier(run_script):
    """An omitted key means undisclosed, which is treated as worst case -- not as zero."""
    out = rank(run_script, [
        c("UNKNOWN", "high", pct=0.9),
        c("FLAGGED", "high", ["a", "b"], 0.1),
    ]).json()
    assert symbols(out) == ["FLAGGED", "UNKNOWN"]


def test_empty_risk_flags_differs_from_an_omitted_key(run_script):
    out = rank(run_script, [
        c("OMITTED", "high", pct=0.5),
        c("EMPTY", "high", [], 0.5),
    ]).json()
    assert symbols(out) == ["EMPTY", "OMITTED"]


def test_deeper_below_the_52wk_high_breaks_a_tie(run_script):
    out = rank(run_script, [
        c("SHALLOW", "medium", [], 0.05),
        c("DEEP", "medium", [], 0.40),
        c("MID", "medium", [], 0.20),
    ]).json()
    assert symbols(out) == ["DEEP", "MID", "SHALLOW"]


def test_omitted_pct_sorts_last_among_equals(run_script):
    out = rank(run_script, [
        c("NOPCT", "high", []),
        c("ZERO", "high", [], 0.0),
    ]).json()
    assert symbols(out) == ["ZERO", "NOPCT"]


def test_null_pct_is_treated_as_omitted(run_script):
    out = rank(run_script, [
        c("NULLPCT", "high", [], None),
        c("ZERO", "high", [], 0.0),
    ]).json()
    assert symbols(out) == ["ZERO", "NULLPCT"]


def test_sort_is_stable_for_full_ties(run_script):
    out = rank(run_script, [
        c("FIRST", "high", [], 0.3),
        c("SECOND", "high", [], 0.3),
        c("THIRD", "high", [], 0.3),
    ]).json()
    assert symbols(out) == ["FIRST", "SECOND", "THIRD"]


def test_a_high_conviction_top_up_can_outrank_a_new_entry(run_script):
    """Groups compete on equal footing -- group is carried through, never sorted on."""
    out = rank(run_script, [
        {"symbol": "NEWLOW", "conviction": "low", "group": "new", "risk_flags": [],
         "pct_below_52wk_high": 0.5},
        {"symbol": "HELDHIGH", "conviction": "high", "group": "held", "risk_flags": [],
         "pct_below_52wk_high": 0.1},
    ]).json()
    assert symbols(out) == ["HELDHIGH", "NEWLOW"]
    assert out[0]["group"] == "held", "unrelated fields must survive the sort"


def test_output_is_chainable_into_position_sizing(run_script, size_positions):
    ranked = rank(run_script, [
        {"symbol": "LOWCONV", "conviction": "low", "group": "new", "risk_flags": []},
        {"symbol": "HIGHCONV", "conviction": "high", "group": "new", "risk_flags": []},
    ]).json()
    sized = size_positions(ranked).json()
    assert [r["symbol"] for r in sized["results"]] == ["HIGHCONV", "LOWCONV"]
    assert sized["results"][0]["dollar_amount"] == 100.00


def test_empty_list_is_a_clean_no_op(run_script):
    assert rank(run_script, []).json() == []


# --- failure contract -------------------------------------------------------

def test_invalid_conviction_is_a_json_error(run_script):
    err = rank(run_script, [c("AAA", "extremely_high", [], 0.1)]).error()
    assert "extremely_high" in err


def test_missing_conviction_is_a_json_error(run_script):
    err = rank(run_script, [{"symbol": "AAA"}]).error()
    assert "AAA" in err


def test_malformed_json_is_a_json_error(run_script):
    result = run_script("rank_candidates.py")
    assert result.returncode == 1
    assert "error" in result.stderr
