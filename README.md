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

## Repository layout

```
apps/api               Fastify + Prisma API (SQLite in dev, Postgres in prod)
  src/domain/          Day-classification engine (pure, unit-tested)
  prisma/              Schema, migrations, demo seed (hockey content)
apps/mobile            Expo (React Native) app — player "Today" view
packages/shared-types  Domain types & DTOs shared by API and clients
```

## Auth

Two modes, chosen by whether `CLERK_ISSUER` is set on the API:

- **Dev mode** (default, no config): requests identify themselves with an
  `x-user-id` header; create users with `POST /auth/dev-signup`. This is what
  the seed flow and the examples below use.
- **Clerk mode**: create a Clerk app (clerk.com), set `CLERK_ISSUER` to your
  Frontend API URL in `apps/api/.env`, and set
  `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` for the mobile app. The API verifies
  session JWTs against Clerk's JWKS (standard OIDC via `jose` — no vendor SDK
  server-side). On first sign-in the app collects name/role via
  `POST /auth/register`. Optionally add `email`/`name` claims to the session
  token (Clerk dashboard → JWT template) to pre-fill profiles. The `x-user-id`
  stub and `/auth/dev-signup` are disabled in this mode.

Under-13 players don't self-signup: adults (coaches/parents) authenticate, and
guardian-managed player profiles + the parental-consent flow arrive in Phase 2
(see `docs/ARCHITECTURE.md` §8).

## Getting started

Requires Node 20+.

```bash
npm install

# API: create the dev database, seed demo data, start on :3000
cd apps/api && cp .env.example .env && cd ../..
npm run db:migrate --workspace apps/api     # first time only
npm run db:seed --workspace apps/api        # prints demo user ids
npm run api

# Smoke test (use the player id printed by the seed)
curl -H "x-user-id: <player-id>" http://localhost:3000/me/today

# Mobile app (Expo) — point it at your machine's LAN IP, not localhost
EXPO_PUBLIC_API_URL=http://<your-ip>:3000 \
EXPO_PUBLIC_DEV_USER_ID=<player-id> \
npm run mobile

# Tests and typechecks
npm test
npm run typecheck
```

### Connect a TeamSnap (or any ICS) calendar

In TeamSnap: Schedule tab → **Subscribe / Export** → copy the calendar URL
(`webcal://ical-cdn.teamsnap.com/team_schedule/<token>.ics`). Then, as the
team's coach:

```bash
curl -X PUT http://localhost:3000/teams/<team-id>/ics \
  -H "x-user-id: <coach-id>" -H 'content-type: application/json' \
  -d '{"url":"webcal://ical-cdn.teamsnap.com/team_schedule/<token>.ics"}'
```

The importer normalizes `webcal://`, classifies games vs. practices (a
games-only companion feed via `"gamesUrl"` makes the split exact; otherwise
title heuristics like "vs." / "@" apply), and upserts events by ICS UID —
re-syncs pick up moved and cancelled events without duplicating anything.
Events only import into an existing season window, so set up the season
first. Misclassified events can be fixed with `PATCH /events/<id>
{"type":"game"}`; corrections survive re-syncs. The same endpoint works for
SportsEngine, Spond, and BenchApp feeds.

After connecting, the API keeps the schedule fresh on its own: a background
scheduler re-syncs every connected team on an interval
(`ICS_SYNC_INTERVAL_MINUTES`, default 60; `0` disables it) and records feed
health on the team (`icsSyncStatus`, `icsSyncError`, `icsLastSyncedAt` in
`GET /teams/<id>`), so a broken feed URL is visible to the coach instead of
failing silently. `POST /teams/<team-id>/ics/sync` remains as the manual
"Sync now".

The seed creates a demo hockey team ("Riverside Ravens") with a season spanning today, Tue/Thu practices, Sat games, and the three launch routines — so `/me/today` demonstrates every in-season day type:

| Day | Classification | Routine served |
|---|---|---|
| Tue/Thu | `PRACTICE_DAY` | Pre-Practice Warm-Up |
| Sat | `GAME_DAY` | Game-Day Warm-Up |
| other in-season days | `IN_SEASON_OFF_DAY` | Off-Day Home Session |
| outside the season | `OFF_SEASON` | (programs arrive in Phase 3) |

## Status

Phase 0 walking skeleton (see [`docs/PLAN.md`](docs/PLAN.md)):

- ✅ Monorepo, shared types, CI-ready scripts (`npm test`, `npm run typecheck`)
- ✅ Core schema: users, teams, memberships, seasons, schedule events, drills, routines
- ✅ Day-classification engine with unit tests, wired to `GET /me/today`
- ✅ Team create/join, season + schedule endpoints with coach-role checks
- ✅ Expo app rendering the Today view against the API
- ✅ ICS schedule import (TeamSnap/SportsEngine/Spond/BenchApp feeds): idempotent sync, game/practice classification, coach corrections
- ✅ Background feed sync with per-team health tracking (interval via `ICS_SYNC_INTERVAL_MINUTES`)
- ✅ Auth via Clerk: JWKS-verified session JWTs on the API, email-code sign-in in the app, first-run profile registration (dev stub retained when `CLERK_ISSUER` is unset)
- ⏳ Video pipeline, off-season programs (Phases 2–3)
