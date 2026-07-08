# Athlete Guide

A training companion app for youth/amateur team-sport athletes — starting with **hockey** — that adapts to the athlete's calendar: it knows whether today is a game day, a practice day, an in-season off day, or the off-season, and serves the right guidance for that day.

## What it does

| Requirement (from product notes) | Feature |
|---|---|
| Split between in-season and off-season | Season-aware app modes driven by season start/end dates |
| Setup when season starts and ends | Season setup flow (per team, per sport) |
| Setup sport focus, start with hockey | Sport catalog; all content keyed by sport (hockey first) |
| Setup team practice schedule; connect to other platforms? | Schedule builder + ICS calendar import (TeamSnap/SportsEngine feeds), native API sync later |
| Setup game schedule; connect to other platforms? | Same scheduling engine, event type = game |
| Warm-up activities for practice days and game days | Warm-up routines auto-surfaced on the player's "Today" view |
| In-home practice and exercise guide for in-season off days | Home training programs surfaced on off days |
| Player account and views | Player role: Today view, calendar, programs, video uploads, feedback |
| Coach account and views | Coach role: roster, schedules, review queue, team adherence |
| Players upload videos for coach review and AI guidance | Video pipeline: upload → AI analysis draft → coach review → feedback to player |
| Off-season end-to-end guidance from sport, age, height, weight, focus area | AI-assisted, template-constrained periodized off-season program generator |

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture, data model, key flows, tech stack
- [`docs/PLAN.md`](docs/PLAN.md) — phased delivery plan with milestones

## Status

Planning phase. No application code yet — see the plan for the build order.
