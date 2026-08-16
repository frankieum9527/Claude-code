#!/usr/bin/env python3
# Part of agentic-trader, adapted from FriesTrader
# (https://github.com/YizhiSong/FriesTrader), Copyright (c) 2026 Yizhi Song,
# MIT License -- see LICENSE and NOTICE.
"""Compute tiered take-profit firing for one position, per
risk_rules.json/PHASE_B_TASK.md Step 5.

Tiers are evaluated in ascending gain_pct order; a tier already fired
this holding period is skipped, and a tier whose gain_pct is now met is
fired against the position's quantity as it stands after any earlier
tier fired in this same cycle has already reduced it.

Fired state is keyed on each tier's stable `id`, never on its gain_pct.
Keying on the value meant that retuning a tier (0.15 -> 0.18) made an
already-fired tier look unfired against a position still held, firing it
a second time and selling another sell_fraction of that position. Ids are
assigned in risk_rules.json and must never be reused or renumbered.
"""
import argparse

from _common import RiskInputError, emit, run


def parse_tiers(s):
    """Parse "id:gain_pct:sell_fraction" triples into ascending-gain tier dicts."""
    tiers = []
    seen_ids = set()
    for part in s.split(","):
        fields = part.split(":")
        if len(fields) != 3:
            raise RiskInputError(
                f"tier {part!r} must be 'id:gain_pct:sell_fraction' (three colon-separated "
                f"fields), got {len(fields)}"
            )
        tier_id, gain_pct_str, sell_fraction_str = fields
        tier_id = tier_id.strip()
        if not tier_id:
            raise RiskInputError(f"tier {part!r} has an empty id")
        if tier_id in seen_ids:
            raise RiskInputError(
                f"duplicate tier id {tier_id!r} -- ids are the fired-state key and must be unique"
            )
        seen_ids.add(tier_id)
        try:
            gain_pct = float(gain_pct_str)
            sell_fraction = float(sell_fraction_str)
        except ValueError:
            raise RiskInputError(f"tier {part!r} has a non-numeric gain_pct or sell_fraction")
        if not 0 < sell_fraction <= 1:
            raise RiskInputError(
                f"tier {tier_id!r} sell_fraction {sell_fraction} must be in (0, 1]"
            )
        tiers.append({"id": tier_id, "gain_pct": gain_pct, "sell_fraction": sell_fraction})
    tiers.sort(key=lambda t: t["gain_pct"])
    return tiers


def parse_id_set(s):
    if not s:
        return set()
    return {x.strip() for x in s.split(",") if x.strip()}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--average-cost", type=float, required=True)
    p.add_argument("--current-price", type=float, required=True)
    p.add_argument("--quantity", type=float, required=True,
                    help="position quantity as it stands right now, before this cycle's tiers are evaluated")
    p.add_argument("--tiers", type=parse_tiers, required=True,
                    help="risk_rules.json take_profit.tiers as id:gain_pct:sell_fraction triples, "
                         "e.g. 'tp1:0.15:0.25,tp2:0.30:0.25,tp3:0.50:0.25'")
    p.add_argument("--already-fired", type=parse_id_set, default=set(),
                    help="comma-separated tier IDs already fired this holding period "
                         "(from a trade_log.jsonl lookup), e.g. 'tp1'")
    args = p.parse_args()

    if args.average_cost <= 0:
        raise RiskInputError("average_cost must be positive")
    if args.quantity < 0:
        raise RiskInputError("quantity must not be negative")

    known_ids = {t["id"] for t in args.tiers}
    unknown = sorted(args.already_fired - known_ids)
    if unknown:
        raise RiskInputError(
            f"--already-fired names tier id(s) {unknown} not present in --tiers "
            f"{sorted(known_ids)} -- a tier id was renamed or removed while a holding period "
            f"was still open, so fired state can no longer be resolved safely"
        )

    gain_pct = (args.current_price - args.average_cost) / args.average_cost

    tiers_status = []
    fired_this_cycle = []
    running_qty = args.quantity

    for tier in args.tiers:
        if tier["id"] in args.already_fired:
            tiers_status.append({"tier_id": tier["id"], "gain_pct": tier["gain_pct"], "fired": True})
            continue
        if gain_pct >= tier["gain_pct"]:
            quantity_before = running_qty
            quantity_sold = quantity_before * tier["sell_fraction"]
            running_qty -= quantity_sold
            fired_this_cycle.append({
                "tier_id": tier["id"],
                "tier_gain_pct": tier["gain_pct"],
                "sell_fraction": tier["sell_fraction"],
                "quantity_before": round(quantity_before, 6),
                "quantity_sold": round(quantity_sold, 6),
            })
            tiers_status.append({"tier_id": tier["id"], "gain_pct": tier["gain_pct"], "fired": True})
        else:
            tiers_status.append({"tier_id": tier["id"], "gain_pct": tier["gain_pct"], "fired": False})

    triggered = len(fired_this_cycle) > 0

    emit({
        "gain_pct": round(gain_pct, 6),
        "tiers_status": tiers_status,
        "fired_this_cycle": fired_this_cycle,
        "triggered": triggered,
        "action": "sell_partial_position" if triggered else "hold_monitor",
    })


if __name__ == "__main__":
    run(main)
