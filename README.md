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

Two modes, chosen by whether `AUTH_ISSUER` is set on the API:

- **Dev mode** (default, no config): requests identify themselves with an
  `x-user-id` header; create users with `POST /auth/dev-signup`. This is what
  the seed flow and the examples below use.
- **Firebase mode**: create a Firebase project (console.firebase.google.com),
  enable the **Email/Password** sign-in method, and register a web app to get
  its config. Then set in `apps/api/.env`:

  ```
  AUTH_ISSUER=https://securetoken.google.com/<project-id>
  AUTH_AUDIENCE=<project-id>
  ```

  and for the mobile app: `EXPO_PUBLIC_FIREBASE_API_KEY`,
  `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, `EXPO_PUBLIC_FIREBASE_APP_ID`.

  The API verifies Firebase ID tokens via the issuer's OIDC discovery
  document + JWKS (standard OIDC via `jose` — no Firebase SDK server-side, so
  any compliant provider works by changing the two env vars). On first
  sign-in the app collects name/role via `POST /auth/register`; Firebase
  tokens carry `email`/`name` claims, which pre-fill the profile. The
  `x-user-id` stub and `/auth/dev-signup` are disabled in this mode.

Under-13 players don't self-signup: adults (coaches/parents) authenticate, and
guardian-managed player profiles + the parental-consent flow arrive in Phase 2
(see `docs/ARCHITECTURE.md` §8).

## Getting started

### Zero local setup (GitHub Codespaces)

No Node or npm needed on your machine — everything runs in the browser:

1. On the GitHub repo page: **Code → Codespaces → Create codespace** on this
   branch. Wait for setup to finish (it installs dependencies and seeds the
   demo database automatically).
2. In the terminal at the bottom: `npm run api`
3. In a second terminal (the `+` button in the terminal panel): `npm run web`
   — ignore the QR code; that's for the Expo Go phone app.
4. In the **Ports** panel (next to the Terminal tab): right-click the row for
   port **3000** → **Port Visibility** → **Public**. Without this the
   browser's API requests are blocked by GitHub's auth wall.
5. Open the port **8081** URL from the Ports panel (globe icon) — that's the
   app. It auto-detects Codespaces and finds the API on its own; on first
   launch it signs you in as a fresh demo user, so you'll land on the
   Get-started screen — join the seeded team with code `RAVENS26`, or create
   your own.

Once the app is open, use the dark **demo bar** at the bottom (dev mode only):
switch between personas — Riley Player, Casey Coach, or a brand-new user —
and time-travel the date with ◀ ▶ (or the 7-day jumps) to see practice days,
game days, home training days, and the off-season without waiting for the
calendar. No env vars or restarts needed.

### Local (requires Node 20+, from nodejs.org)

```bash
npm install
npm run setup        # creates the dev DB, migrates, seeds; prints demo user ids
npm run api          # API on :3000

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
| outside the season | `OFF_SEASON` | The player's generated off-season program (or the plan-builder card) |

## Status

Phase 0 walking skeleton (see [`docs/PLAN.md`](docs/PLAN.md)):

- ✅ Monorepo, shared types, CI-ready scripts (`npm test`, `npm run typecheck`)
- ✅ Core schema: users, teams, memberships, seasons, schedule events, drills, routines
- ✅ Day-classification engine with unit tests, wired to `GET /me/today`
- ✅ Team create/join, season + schedule endpoints with coach-role checks
- ✅ Expo app rendering the Today view against the API
- ✅ ICS schedule import (TeamSnap/SportsEngine/Spond/BenchApp feeds): idempotent sync, game/practice classification, coach corrections
- ✅ Background feed sync with per-team health tracking (interval via `ICS_SYNC_INTERVAL_MINUTES`)
- ✅ Auth via Firebase: OIDC discovery + JWKS-verified ID tokens on the API (provider-agnostic), email/password sign-in in the app, first-run profile registration (dev stub retained when `AUTH_ISSUER` is unset)
- ✅ Coach view in the app (Coach tab for coach members): roster, invite code, next-30-days schedule with game/practice corrections and manual add-event (season-window validated), feed health + connect/sync incl. optional games-only feed (`GET /me`, `GET /teams/:id`, `GET /teams/:id/schedule` — member-only)
- ✅ Full onboarding loop in the app: create team or join by code (case-insensitive) when a user has no team; season setup card in the coach view — a new coach gets from sign-in to a feed-synced team without leaving the app
- ✅ Video review loop (Phase 2, coach-manual): players upload drill videos from home sessions, coaches watch and reply from a review queue in the Coach tab; under-13 uploads are blocked without parental consent (`consent_required`); videos visible only to the player and their team's coaches. Storage is behind an interface (`apps/api/src/storage.ts`) — local disk in dev, GCS/Firebase Storage adapter at deploy time
- ✅ Server-synced drill completions with streaks (`GET/PUT /me/completions`) and a coach adherence card (`GET /teams/:id/adherence` — active days, drill counts, last active per player)
- ✅ AI feedback drafts: video upload triggers frame sampling (ffmpeg) + a Claude vision call grounded in a per-drill rubric; the draft pre-fills the coach's review box (labeled, editable) and is never shown to players — set `ANTHROPIC_API_KEY` for real drafts or `AI_FAKE=1` for deterministic dev drafts
- ✅ Off-season program generator: `POST /me/program` builds a periodized plan (recovery → strength base → skills → pre-season ramp) from age/height/weight/focus areas inside a code-owned skeleton with hard age-band guardrails (volume caps, banned loading for younger bands, mandatory rest days); Claude personalizes sessions within the frame when credentials are set, a deterministic exercise catalog fills it otherwise, and every plan is validated before storing. The Today view serves the day's session (or rest day) all off-season; players build the plan right from the off-season Today screen
- ⏳ Guardian accounts + consent UX, video transcoding, coach review of programs (Phase 3)
