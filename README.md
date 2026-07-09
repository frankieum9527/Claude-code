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
- ⏳ Managed auth (dev stub: `x-user-id` header — see `apps/api/src/auth.ts`)
- ⏳ ICS schedule import, video pipeline, off-season programs (Phases 1–3)
