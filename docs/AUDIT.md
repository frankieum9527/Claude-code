# End-to-end audit — 2026-07-12

Full-system audit of the Athlete Guide API and app: code review of every
route for authorization gaps, a from-scratch environment bootstrap, and an
adversarial end-to-end run of every feature loop.

## Method

1. **Static review** of all route handlers, the auth layer (`requireUser` /
   `requireActor`), the storage adapter, the ICS fetcher/importer, and the
   background workers — focused on authorization, tenant isolation,
   youth-safety guarantees, and input handling.
2. **Fresh-environment bootstrap**: empty database → `prisma migrate deploy`
   (all migrations from zero) → seed → boot. Verifies the "new Codespace
   just works" promise.
3. **Adversarial end-to-end run**: `apps/api/scripts/audit.e2e.mjs` — 83
   checks over the wire against the fresh instance, covering every feature
   loop plus attack cases (see below). Reusable; run instructions are in the
   script header.
4. **Unit suite**: 73 tests (day classification, streaks, age math, ICS
   parsing/normalization/redirects, program skeleton/guardrails/generation,
   AI drafting, storage traversal, OIDC verification) + typecheck.
5. UI flows were verified during development with Playwright against the
   real web build (screenshots per feature); this audit re-verified the API
   contracts underneath them.

## What the e2e run covers

- **Auth surface**: missing/unknown identity → 401; dev-only endpoints 404
  when OIDC is enabled (unit-tested); registration flow.
- **Cross-team isolation matrix**: a coach of another team is refused on
  every team-scoped read and write (detail, schedule, adherence, review
  queue, programs, seasons, events, ICS feed, program edits, video
  viewing/feedback); players are refused on coach-only endpoints;
  non-members on member endpoints.
- **Day classification**: practice/game/off-day/off-season with the right
  routine for each; input validation.
- **Completions & streaks**: record, toggle, unknown drill.
- **Video loop**: upload URL ownership, double-upload conflict, path
  traversal (`/uploads/../..`), AI draft reaching the coach queue, **AI
  drafts never leaking to players**, self-feedback refusal, coach feedback
  round-trip.
- **Guardian & consent lifecycle (COPPA)**: child profile creation bounds
  (4–17), children cannot manage children, acting via `x-child-id` is
  guardian-verified, consent grant → upload allowed, **revocation blocks
  both new submissions and already-issued upload URLs**, non-guardians can
  neither act nor grant consent.
- **Off-season programs**: window/focus validation, age-band volume clamps,
  **stored birthdate overriding client-supplied age**, Sunday-always-rest,
  coach editing (rest-day 409, banned-term 400, cross-team 403, player 403,
  `coachEdited` visible to the player), coach board ordering.
- **ICS import**: connect + import, idempotent re-sync, title-based
  game/practice classification, moved events updating, **coach type
  corrections surviving re-syncs**, feed-health tracking through
  break/recover, unreachable feeds rejected without being stored.

Result: **83 / 83 checks pass** (with a real video supplied via
`AUDIT_VIDEO`; without one, the video section instead asserts the AI
pipeline degrades safely — no draft is fabricated from undecodable bytes).

## Findings

### Fixed during this audit

| # | Severity | Finding | Fix |
|---|---|---|---|
| AG-1 | High | **Consent revocation didn't close the pending-upload window.** The COPPA gate ran only at `POST /submissions`; an upload URL issued before revocation still accepted video bytes after it. | Consent is re-checked in `PUT /uploads/*`; verified by e2e check "revocation closes the pending-upload window". |
| AG-2 | Medium | **ICS fetch followed redirects blindly.** The private-host SSRF check validated only the original URL; a public feed could 302 the server into internal addresses. | `fetchIcs` now follows redirects manually (max 4 hops) and re-validates every hop through `normalizeIcsUrl`; unit tests added. |
| AG-3 | Medium | **Program guardrails trusted client-supplied age.** A guardian (or player) could claim age 17 for a 10-year-old, weakening the safety band. | When the acting profile has a birthdate on file (guardian-managed children always do), the band is derived from it; the client age is only a fallback for self-signup users without one. Verified by e2e ("birthdate overrides client age"). |

### Accepted / by design

| # | Finding | Rationale |
|---|---|---|
| AG-4 | Missing `ffmpeg` silently disables AI drafts (info log only). | Fails safe: no frames → no draft → coach-manual path unaffected; drafts must never be fabricated. Set `FFMPEG_PATH` when ffmpeg isn't on `PATH`. |
| AG-5 | `PUT /me/completions` accepts arbitrary dates, so streaks can be backfilled. | Self-reported training data; the incentive to cheat one's own streak is low and the coach adherence view is directional, not authoritative. |
| AG-6 | Coach session edits are read-modify-write on the plan JSON (no optimistic locking). | One coach per team in practice; a lost update touches one session and is re-editable. Revisit with multi-coach teams. |
| AG-7 | `GET /teams/:id` exposes the join code to all members, not just coaches. | Players inviting teammates is desired; codes are rotatable by re-creating the team (rotation endpoint is a natural later add). |
| AG-8 | Dev auth (`x-user-id`) allows impersonation. | Dev-only by construction: enabling OIDC (`AUTH_ISSUER`) disables the header and the dev endpoints (verified: they 404). |

### Deferred to deployment (Phase 3)

| # | Finding | Plan |
|---|---|---|
| AG-9 | No rate limiting (join-code guessing, upload spam, auth probing). | Add `@fastify/rate-limit` (or platform WAF) at deploy; join codes are 8 hex chars (4 bytes entropy) which is fine *with* rate limiting. |
| AG-10 | Residual DNS-level SSRF: a public hostname can resolve to a private IP (AG-2 fixed the URL/redirect layer only). | At deploy, pin resolved IPs or route feed fetches through an egress proxy with a private-range denylist. |
| AG-11 | Videos are streamed as `video/mp4` regardless of actual container; no transcoding. | Phase 3 transcoding item; harmless for playback in current clients. |
| AG-12 | Multi-team players: `/me/today` uses the first membership. | Known single-team simplification, documented in the shell; team switcher when demand exists. |
| AG-13 | Guardian identity is asserted, not verified (no email verification / stronger KYC for consent). | Standard for COPPA "verifiable parental consent" at scale; needs an email-verification step at deploy (README status item). |

## Assurance summary

The invariants the product's safety story rests on were all verified
end-to-end on a fresh environment:

1. Tenant isolation: no cross-team read or write path found.
2. AI feedback is coach-in-the-loop: drafts are never visible to players.
3. COPPA gate: under-13 video upload is impossible without live guardian
   consent, in both directions (grant and revoke), on every upload path.
4. Youth training guardrails bind every plan-content producer — the AI, the
   stock generator, and coach edits — and the age band comes from the
   profile's birthdate when one exists.
5. A clean checkout bootstraps from zero (migrations → seed → boot) with
   no manual steps.

---

# Pre-deployment audit — Pass 2 (2026-07-15)

Second audit pass, gating deployment. Re-verified the full system after the
features added since Pass 1 (device-local day classification, checkable
off-season program items, the week-at-a-glance strip + completion
celebration, local training reminders, plan-builder profile prefill, video
upload progress, and the offline Today cache), and reviewed production
configuration specifically for "what breaks when this is deployed."

## Method

1. **Full regression**: 77 unit tests + typecheck clean; the 91-check
   adversarial e2e harness (`apps/api/scripts/audit.e2e.mjs`) passes 91/91
   on a fresh database (migrate-from-zero → seed → boot).
2. **Client-only code review** — the newest surface the API harness can't
   reach: the offline cache identity scoping (`src/todayCache.ts`), local
   reminders (`src/notifications.ts`), device-local dates (`src/dates.ts`),
   and upload progress.
3. **Production-config review**: auth-mode fail-safety, CORS, DB provider,
   storage adapter, secret handling.

## Findings

### Fixed during this pass

| # | Severity | Finding | Fix |
|---|---|---|---|
| AG-14 | **Critical** | **Dev-stub auth did not fail closed in production.** With `AUTH_ISSUER` unset the API accepts `x-user-id: <any-id>` and impersonates that user. Pass 1 accepted this as dev-only (AG-8), but nothing *enforced* it — a production deploy that forgot to set `AUTH_ISSUER` would silently expose a complete auth bypass. | `assertAuthConfigured()` runs at boot (`src/index.ts`) and refuses to start when `NODE_ENV=production` and OIDC is unconfigured, unless `ALLOW_DEV_AUTH=1` is set explicitly. Verified: a prod boot without OIDC now aborts with a clear message; unit-tested (4 cases). This supersedes AG-8. |

### Reviewed clean (new features)

- **Offline cache** (`todayCache.ts`): scoped to the acting identity — dev
  `x-user-id`, or the OIDC token's decoded `sub` claim, plus the child
  scope. A different user derives a different key, so no cross-user read is
  possible; any decode failure returns null (fails safe). The `sub` is used
  only as a cache key, never for authorization. Residual note: cached data
  sits unencrypted in AsyncStorage/localStorage and is not purged on
  sign-out (keyed so another account can't read it, but present at rest) —
  acceptable for this data class; add a sign-out purge if storing anything
  more sensitive later.
- **Local reminders** (`notifications.ts`): morning copy matches the day and
  rest days stay silent; `8:00` is parsed as device-local time (consistent
  with the timezone fix); cancel-all-then-reschedule is idempotent; all
  no-ops on web. Native delivery still needs an on-device smoke test in a
  dev build (can't be exercised in the sandbox).
- **Program item completions, week strip, profile prefill, timezone**: all
  covered by the e2e harness (91 checks) and/or unit tests.

### Deployment go / no-go checklist

**Must be set before serving real users** (the deploy is unsafe without these):

- [ ] `AUTH_ISSUER` + `AUTH_AUDIENCE` (Firebase or other OIDC). Without it the
      new AG-14 guard refuses to boot in `NODE_ENV=production` — by design.
- [ ] Prisma `provider = "postgresql"` + a real `DATABASE_URL`, then
      `prisma migrate deploy`. (Dev/CI stay on SQLite.)
- [ ] A cloud `BlobStorage` adapter (GCS/Firebase Storage) behind the
      existing interface; `LocalBlobStorage` is dev-only and won't survive
      an ephemeral container.
- [ ] Rate limiting (AG-9) in front of auth, join-by-code, and uploads —
      `@fastify/rate-limit` or the platform WAF.
- [ ] `ANTHROPIC_API_KEY` (real AI drafts) or accept the coach-manual path;
      `FFMPEG_PATH` if ffmpeg isn't on `PATH`.

**Recommended at deploy** (documented, non-blocking):

- [ ] DNS-rebinding SSRF hardening for ICS fetches (AG-10).
- [ ] Guardian email verification for COPPA "verifiable consent" (AG-13).
- [ ] Video transcoding (AG-11); per-team timezones + multi-team (AG-12).

## Verdict

**Code is deployment-ready; configuration is the remaining gate.** No new
correctness or isolation defects surfaced. The one security issue found
(AG-14) is fixed and now *enforces* the safe configuration rather than
trusting the operator to remember it. Everything left is deployment wiring
(managed auth, Postgres, cloud storage, rate limiting), tracked in the
checklist above.
