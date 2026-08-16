#!/usr/bin/env python3
# Part of agentic-trader, adapted from FriesTrader
# (https://github.com/YizhiSong/FriesTrader), Copyright (c) 2026 Yizhi Song,
# MIT License -- see LICENSE and NOTICE.
"""Run Step 5's per-candidate position-sizing/risk_check math over an
already priority-sorted candidate list, per risk_rules.json/
PHASE_B_TASK.md.

Candidates are processed in the order given (the caller must have
already applied the conviction/risk_flags/pct_below_52wk_high sort) so
that cash_remaining and concurrent_positions_after compound correctly
across the list, the same way a human working top-to-bottom down a
priority list would.

Candidate JSON is read from stdin, an array of objects:
  {"symbol": "GTLB", "group": "new", "conviction": "high"}
  {"symbol": "AMZN", "group": "held", "conviction": "high", "current_position_value": 100.39}
`group` is "new" or "held". `current_position_value` is required for
"held" candidates only.
"""
import argparse

from _common import RiskInputError, emit, load_stdin_candidates, run


def parse_pct_map(s):
    """Parse the "tier:pct,..." conviction sizing table from risk_rules.json."""
    out = {}
    for part in s.split(","):
        fields = part.split(":")
        if len(fields) != 2:
            raise RiskInputError(
                f"conviction tier {part!r} must be 'tier:pct' (two colon-separated fields), "
                f"got {len(fields)}"
            )
        tier, pct_str = fields[0].strip(), fields[1]
        if not tier:
            raise RiskInputError(f"conviction tier {part!r} has an empty tier name")
        try:
            pct = float(pct_str)
        except ValueError:
            raise RiskInputError(f"conviction tier {tier!r} has a non-numeric pct {pct_str!r}")
        if not 0 < pct <= 1:
            raise RiskInputError(
                f"conviction tier {tier!r} pct {pct} must be a fraction in (0, 1]"
            )
        out[tier] = pct
    return out


def validate_config(args):
    """Reject an unusable risk config up front, rather than per-candidate.

    The per-candidate ``conviction_pct > max_position_pct`` check below can
    only ever reject one candidate at a time, and is unreachable whenever
    the tiers are set at or under the cap -- which is the only sane way to
    set them. Catching an over-cap tier here instead turns a silently dead
    guard into a real one: a config that could size past
    max_position_pct_of_account fails the whole cycle instead of quietly
    sizing past it for every candidate in that tier.
    """
    if args.total_value <= 0:
        raise RiskInputError(f"--total-value must be positive, got {args.total_value}")
    if args.cash_start < 0:
        raise RiskInputError(f"--cash-start must not be negative, got {args.cash_start}")
    if args.concurrent_positions_start < 0:
        raise RiskInputError(
            f"--concurrent-positions-start must not be negative, "
            f"got {args.concurrent_positions_start}"
        )
    if args.max_concurrent_positions < 0:
        raise RiskInputError(
            f"--max-concurrent-positions must not be negative, got {args.max_concurrent_positions}"
        )
    if not 0 < args.max_position_pct <= 1:
        raise RiskInputError(
            f"--max-position-pct must be a fraction in (0, 1], got {args.max_position_pct}"
        )
    if not 0 <= args.min_cash_buffer_pct <= 1:
        raise RiskInputError(
            f"--min-cash-buffer-pct must be a fraction in [0, 1], got {args.min_cash_buffer_pct}"
        )

    over_cap = sorted(
        (tier, pct) for tier, pct in args.conviction_pct.items() if pct > args.max_position_pct
    )
    if over_cap:
        detail = ", ".join(f"{tier}={pct:.4%}" for tier, pct in over_cap)
        raise RiskInputError(
            f"conviction tier(s) sized above max_position_pct_of_account "
            f"({args.max_position_pct:.4%}): {detail} -- fix risk_rules.json "
            f"position_sizing.conviction_pct_of_account before trading"
        )


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--total-value", type=float, required=True)
    p.add_argument("--cash-start", type=float, required=True,
                    help="live cash balance (get_portfolio.cash) at the start of Step 5")
    p.add_argument("--concurrent-positions-start", type=int, required=True,
                    help="live open position count at the start of Step 5, after any sells this cycle resolved")
    p.add_argument("--entries-halted", action="store_true",
                    help="set if the loss-limit check (or a stop-loss/take-profit script failure) halted entries this cycle")
    p.add_argument("--max-position-pct", type=float, required=True,
                    help="risk_rules.json position_sizing.max_position_pct_of_account")
    p.add_argument("--max-concurrent-positions", type=int, required=True)
    p.add_argument("--min-cash-buffer-pct", type=float, required=True)
    p.add_argument("--min-top-up-usd", type=float, required=True)
    p.add_argument("--min-top-up-pct-of-target", type=float, required=True)
    p.add_argument("--conviction-pct", type=parse_pct_map, required=True,
                    help='fixed conviction-tier sizing table, e.g. "high:0.20,medium:0.12,low:0.06"')
    args = p.parse_args()

    validate_config(args)
    candidates = load_stdin_candidates()

    cash_remaining = args.cash_start
    concurrent_positions_after = args.concurrent_positions_start
    min_cash_buffer = args.min_cash_buffer_pct * args.total_value

    results = []

    for i, c in enumerate(candidates):
        if not isinstance(c, dict):
            raise RiskInputError(f"candidate at index {i} is not a JSON object")
        for field in ("symbol", "group", "conviction"):
            if field not in c:
                raise RiskInputError(
                    f"candidate at index {i} ({c.get('symbol', '<no symbol>')!r}) "
                    f"is missing required field {field!r}"
                )
        symbol = c["symbol"]
        group = c["group"]
        conviction = c["conviction"]
        if group not in ("new", "held"):
            raise RiskInputError(
                f"unknown group {group!r} for symbol {symbol} -- expected 'new' or 'held'"
            )
        if conviction not in args.conviction_pct:
            raise RiskInputError(
                f"symbol {symbol} has conviction {conviction!r}, which has no entry in the "
                f"conviction sizing table {sorted(args.conviction_pct)} -- refusing to size it"
            )
        conviction_pct = args.conviction_pct[conviction]

        if args.entries_halted:
            halted_result = {
                "symbol": symbol, "group": group, "conviction": conviction,
                "passed": False,
                "reason": "loss limit halt — daily/weekly drawdown breached",
            }
            if group == "held":
                halted_result["position_action"] = "top_up"
            results.append(halted_result)
            continue

        if group == "new":
            dollar_amount = round(conviction_pct * args.total_value, 2)
            candidate_concurrent_after = concurrent_positions_after + 1
            candidate_cash_after = cash_remaining - dollar_amount

            reasons = []
            if conviction_pct > args.max_position_pct:
                reasons.append(f"position size {conviction_pct:.4%} exceeds max_position_pct_of_account {args.max_position_pct:.4%}")
            if candidate_concurrent_after > args.max_concurrent_positions:
                reasons.append(
                    f"concurrent_positions_after ({candidate_concurrent_after}) exceeds "
                    f"max_concurrent_positions ({args.max_concurrent_positions}) — cap filled by "
                    f"higher-priority candidates this cycle"
                )
            if candidate_cash_after < min_cash_buffer:
                reasons.append(
                    f"cash_remaining after trade (${candidate_cash_after:.2f}) would fall below "
                    f"min_cash_buffer_pct (${min_cash_buffer:.2f}) of total_value"
                )

            if reasons:
                results.append({
                    "symbol": symbol, "group": group, "conviction": conviction,
                    "passed": False, "reason": "; ".join(reasons),
                    "dollar_amount": dollar_amount,
                })
                continue

            cash_remaining = candidate_cash_after
            concurrent_positions_after = candidate_concurrent_after
            results.append({
                "symbol": symbol, "group": group, "conviction": conviction,
                "passed": True,
                "dollar_amount": dollar_amount,
                "concurrent_positions_after": concurrent_positions_after,
                "cash_remaining_after": round(cash_remaining, 2),
                "cash_buffer_after_pct": round(cash_remaining / args.total_value, 6),
            })

        elif group == "held":
            if "current_position_value" not in c:
                raise RiskInputError(
                    f"held candidate {symbol} is missing required field 'current_position_value'"
                )
            current_position_value = c["current_position_value"]
            target_size = conviction_pct * args.total_value
            headroom = target_size - current_position_value

            if headroom <= 0:
                results.append({
                    "symbol": symbol, "group": group, "conviction": conviction,
                    "passed": False, "position_action": "top_up",
                    "reason": "already at or above target size for its conviction tier — no top-up",
                    "current_position_value": round(current_position_value, 2),
                    "target_size": round(target_size, 2),
                    "headroom": round(headroom, 2),
                })
                continue

            ceiling_room = args.max_position_pct * args.total_value - current_position_value
            top_up_amount = round(min(headroom, ceiling_room), 2)
            min_top_up_threshold = round(max(1.00, args.min_top_up_usd,
                                              args.min_top_up_pct_of_target * target_size), 2)

            if top_up_amount < min_top_up_threshold:
                results.append({
                    "symbol": symbol, "group": group, "conviction": conviction,
                    "passed": False, "position_action": "top_up",
                    "reason": (
                        f"top-up amount ${top_up_amount:.2f} is below the min top-up threshold "
                        f"${min_top_up_threshold:.2f} (broker $1.00 minimum vs. min_top_up_usd "
                        f"${args.min_top_up_usd:.2f} vs. min_top_up_pct_of_target "
                        f"{args.min_top_up_pct_of_target:.0%} of target ${target_size:.2f}, "
                        f"whichever is highest) — no order attempted"
                    ),
                    "current_position_value": round(current_position_value, 2),
                    "target_size": round(target_size, 2),
                    "headroom": round(headroom, 2),
                })
                continue

            candidate_cash_after = cash_remaining - top_up_amount
            if candidate_cash_after < min_cash_buffer:
                results.append({
                    "symbol": symbol, "group": group, "conviction": conviction,
                    "passed": False, "position_action": "top_up",
                    "reason": (
                        f"cash_remaining after trade (${candidate_cash_after:.2f}) would fall below "
                        f"min_cash_buffer_pct (${min_cash_buffer:.2f}) of total_value"
                    ),
                    "current_position_value": round(current_position_value, 2),
                    "target_size": round(target_size, 2),
                    "headroom": round(headroom, 2),
                })
                continue

            cash_remaining = candidate_cash_after
            results.append({
                "symbol": symbol, "group": group, "conviction": conviction,
                "passed": True, "position_action": "top_up",
                "current_position_value": round(current_position_value, 2),
                "target_size": round(target_size, 2),
                "headroom": round(headroom, 2),
                "dollar_amount": top_up_amount,
                "cash_remaining_after": round(cash_remaining, 2),
                "cash_buffer_after_pct": round(cash_remaining / args.total_value, 6),
            })

    emit({
        "results": results,
        "cash_remaining_final": round(cash_remaining, 2),
        "concurrent_positions_after_final": concurrent_positions_after,
    })


if __name__ == "__main__":
    run(main)
