# Athlete Guide — Delivery Plan

Four phases, each ending in something usable. Hockey-only until Phase 4. Assumes a small team (1–3 engineers); timelines are calendar estimates, not promises.

## Phase 0 — Foundations (weeks 1–2)

Goal: a walking skeleton you can build on.

- Repo layout (monorepo: `apps/mobile`, `apps/api`, `packages/shared-types`), CI, environments.
- Auth (managed provider), user accounts with roles: player, coach, parent.
- Core schema: users, teams, memberships, seasons, schedule events.
- Team + season setup flow: coach creates team (sport = hockey), sets season start/end, invites players by link/code.

**Exit criteria:** a coach can create a team and season; a player can join it; both sign in on the mobile app.

## Phase 1 — In-season MVP (weeks 3–8)

Goal: the daily loop works — every player opens the app and sees the right thing for today.

- Schedule builder: recurring practices, games (manual entry).
- ICS feed import (covers TeamSnap/SportsEngine/Spond exports) with game/practice classification + coach confirmation.
- Day-classification engine (§4 of architecture) and the player **Today view**.
- Launch content set (hockey): practice-day warm-up, game-day warm-up, and a rotation of in-home sessions for off days — built with a hockey coach/trainer, delivered as seed data with drill videos.
- Coach views: roster, schedule management, season settings.
- Push notifications: morning today-brief, pre-event warm-up reminder.
- Offline caching of today's routine + videos.

**Exit criteria:** pilot with 1–2 real teams for the daily loop. Watch: DAU/roster ratio, session completion rate.

## Phase 2 — Video review + AI feedback (weeks 9–14)

Goal: the off-day home sessions become two-way.

- Video capture/upload from drill screens (signed URLs, background upload, retry).
- Video platform integration (transcode, HLS playback, thumbnails).
- Coach review queue: watch, comment with timestamped notes, approve.
- AI assist v1: pose-estimation metrics + per-drill rubric → Claude-drafted feedback, coach-in-the-loop approval (architecture §6).
- Parental consent + privacy controls shipped **before** any minor uploads video (architecture §8).
- Coach web dashboard (review is much better on a laptop).

**Exit criteria:** median coach review turnaround < 48h on pilot teams; AI draft acceptance rate (coach approves with light edits) > 50%.

## Phase 3 — Off-season programs (weeks 15–20)

Goal: the app stays alive when the season ends.

- Player profile inputs: age (birthdate), height, weight, focus areas, equipment.
- Program template library (hockey): periodized phases — recovery → strength → skills → pre-season ramp.
- AI-assisted program generation within guardrails (architecture §7), coach review/edit of generated programs.
- Off-season Today view: program day rendering, completion tracking, video uploads continue against program drills.
- Adherence dashboard for coaches; weekly progress summaries for players/parents.

**Exit criteria:** ship before pilot teams' seasons end; ≥ 40% weekly program adherence in the first off-season month.

## Phase 4 — Expansion (weeks 21+, demand-driven)

Order by pull, not by roadmap:

- Native schedule integrations (TeamSnap API first) replacing/augmenting ICS polling.
- Second sport (schema already supports it; the work is content + templates).
- Parent accounts with visibility into schedule, adherence, and feedback.
- Monetization: free for basic schedule/warm-ups; subscription for video review + AI + off-season programs (team-level or family-level pricing).
- AI feedback v2: richer pose analytics, side-by-side comparison with reference technique.

## Sequencing rationale & risks

- **Content before code cleverness.** Phase 1's real risk isn't engineering — it's drill/warm-up content quality. Line up a hockey trainer as a content partner in week 1.
- **Privacy gates video.** Phase 2 cannot ship to minors without the consent flow; it's on the critical path, not a compliance afterthought.
- **ICS first, APIs later.** One adapter covers most platforms at 80% fidelity; per-platform API work is deferred until specific demand exists.
- **AI is additive, never load-bearing for safety.** Coach approval gates feedback; templates + guardrails gate programs. If AI quality disappoints early, both features degrade gracefully to coach-manual workflows.
