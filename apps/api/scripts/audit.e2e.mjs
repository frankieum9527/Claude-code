/**
 * End-to-end audit of the Athlete Guide API against a fresh database.
 * Exercises every feature loop plus adversarial cases (cross-team access,
 * consent revocation, guardrail bypasses, path traversal). PASS/FAIL per
 * check; non-zero exit if anything fails.
 *
 * Run (from apps/api):
 *   rm -f prisma/audit.db
 *   DATABASE_URL=file:./audit.db npx prisma migrate deploy
 *   DATABASE_URL=file:./audit.db npx tsx prisma/seed.ts
 *   DATABASE_URL=file:./audit.db AI_FAKE=1 ALLOW_LOCAL_ICS=1 \
 *     ICS_SYNC_INTERVAL_MINUTES=0 PORT=3001 UPLOADS_DIR=/tmp/audit-uploads \
 *     npx tsx src/index.ts &      # add FFMPEG_PATH=... if ffmpeg isn't on PATH
 *   node scripts/audit.e2e.mjs
 *
 * AUDIT_VIDEO may point at any small real video file; without it the video
 * section uploads junk bytes and asserts the AI pipeline degrades safely
 * (no draft, no crash) instead of asserting a draft appears.
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';

const API = process.env.AUDIT_API ?? 'http://localhost:3001';
const VIDEO = process.env.AUDIT_VIDEO ?? null;

let pass = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    failures.push(`${name}${extra ? ` — ${extra}` : ''}`);
    console.log(`  FAIL ${name} ${extra}`);
  }
}
function section(name) {
  console.log(`\n== ${name}`);
}

async function req(method, path, { user, child, body, rawBody, contentType } = {}) {
  const headers = {};
  if (user) headers['x-user-id'] = user;
  if (child) headers['x-child-id'] = child;
  let payload;
  if (rawBody !== undefined) {
    headers['content-type'] = contentType ?? 'video/mp4';
    payload = rawBody;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}
const get = (path, opts) => req('GET', path, opts);
const post = (path, body, opts = {}) => req('POST', path, { ...opts, body });
const put = (path, body, opts = {}) => req('PUT', path, { ...opts, body });

const uniq = Date.now().toString(36);
async function signup(name, role) {
  const r = await post('/auth/dev-signup', {
    name,
    email: `${name.toLowerCase().replace(/\s/g, '.')}-${uniq}@audit.test`,
    role,
  });
  return r.json.id;
}

// --- Local ICS fixture server (API runs with ALLOW_LOCAL_ICS=1) -------------
let feedBroken = false;
let feedMoved = false;
const cal = () =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:audit-1@fixture',
    `DTSTART:${feedMoved ? '20260714T190000Z' : '20260714T180000Z'}`,
    'SUMMARY:Practice',
    'LOCATION:Fixture Rink',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:audit-2@fixture',
    'DTSTART:20260718T150000Z',
    'SUMMARY:vs. Wildcats',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
const fixture = http.createServer((rq, rs) => {
  if (rq.url === '/break') { feedBroken = true; rs.end('ok'); return; }
  if (rq.url === '/fix') { feedBroken = false; rs.end('ok'); return; }
  if (rq.url === '/move') { feedMoved = true; rs.end('ok'); return; }
  if (feedBroken) { rs.writeHead(500); rs.end('boom'); return; }
  if (rq.url === '/cal.ics') {
    rs.writeHead(200, { 'content-type': 'text/calendar' });
    rs.end(cal());
    return;
  }
  rs.writeHead(404);
  rs.end();
});
await new Promise((r) => fixture.listen(3999, '127.0.0.1', r));

// ---------------------------------------------------------------------------
section('A. Bootstrap (fresh DB, all migrations, seed)');
{
  const health = await get('/health');
  check('health endpoint', health.status === 200 && health.json.ok === true);
  const personas = await get('/auth/dev-personas');
  const names = personas.json.personas.map((p) => p.name);
  check('seed personas present', ['Casey Coach', 'Riley Player', 'Pat Parent'].every((n) => names.includes(n)), names.join(','));
  check('children never appear as personas', !names.includes('Jamie Junior'));
}

section('B. Auth surface');
{
  check('no identity → 401', (await get('/me')).status === 401);
  check('unknown user → 401', (await get('/me', { user: 'nope' })).status === 401);
  check('register endpoint 404 in dev mode', (await post('/auth/register', { role: 'coach' })).status === 404);
}

// --- Actors ------------------------------------------------------------------
const coachA = await signup('Audit CoachA', 'coach');
const playerA = await signup('Audit PlayerA', 'player');
const coachB = await signup('Audit CoachB', 'coach');
const playerB = await signup('Audit PlayerB', 'player');
const parent = await signup('Audit Parent', 'parent');

section('C. Onboarding: teams, seasons, events');
let teamA, seasonA, practiceEvent;
{
  const t = await post('/teams', { name: 'Audit Otters', sport: 'hockey' }, { user: coachA });
  check('coach creates team', t.status === 201 && !!t.json.joinCode);
  teamA = t.json;

  const badSeason = await post(`/teams/${teamA.id}/seasons`, { name: 'Bad', startsOn: '2026-08-01', endsOn: '2026-07-01' }, { user: coachA });
  check('season with endsOn<startsOn → 400', badSeason.status === 400);

  const s = await post(`/teams/${teamA.id}/seasons`, { name: 'Audit Season', startsOn: '2026-06-01', endsOn: '2026-08-31' }, { user: coachA });
  check('coach creates season', s.status === 201);
  seasonA = s.json;

  const ev = await post(`/seasons/${seasonA.id}/events`, { type: 'practice', startsAt: '2026-07-20T18:00:00.000Z' }, { user: coachA });
  check('in-window event created', ev.status === 201);
  practiceEvent = ev.json;
  const game = await post(`/seasons/${seasonA.id}/events`, { type: 'game', startsAt: '2026-07-25T15:00:00.000Z', location: 'Audit Arena' }, { user: coachA });
  check('game event created', game.status === 201);
  const outside = await post(`/seasons/${seasonA.id}/events`, { type: 'practice', startsAt: '2026-09-15T18:00:00.000Z' }, { user: coachA });
  check('event outside season window → 400', outside.status === 400);

  const join = await post('/teams/join', { joinCode: teamA.joinCode.toLowerCase() }, { user: playerA });
  check('player joins with lower-cased code', join.status === 200);
  check('bad join code → 404', (await post('/teams/join', { joinCode: 'ZZZZZZZZ' }, { user: playerB })).status === 404);
}

section('D. Cross-team authorization matrix (coach B / player A as adversaries)');
{
  const cases = [
    ['GET team detail', await get(`/teams/${teamA.id}`, { user: coachB })],
    ['GET schedule', await get(`/teams/${teamA.id}/schedule`, { user: coachB })],
    ['GET adherence', await get(`/teams/${teamA.id}/adherence`, { user: coachB })],
    ['GET review queue', await get(`/teams/${teamA.id}/review-queue`, { user: coachB })],
    ['GET programs', await get(`/teams/${teamA.id}/programs`, { user: coachB })],
    ['POST season', await post(`/teams/${teamA.id}/seasons`, { name: 'X', startsOn: '2026-06-01', endsOn: '2026-08-31' }, { user: coachB })],
    ['PUT ics feed', await put(`/teams/${teamA.id}/ics`, { url: 'http://127.0.0.1:3999/cal.ics' }, { user: coachB })],
    ['PATCH event', await req('PATCH', `/events/${practiceEvent.id}`, { user: coachB, body: { type: 'game' } })],
    ['POST event', await post(`/seasons/${seasonA.id}/events`, { type: 'practice', startsAt: '2026-07-21T18:00:00.000Z' }, { user: coachB })],
  ];
  for (const [name, r] of cases) check(`other team's coach: ${name} → 403`, r.status === 403, `got ${r.status}`);

  check("player: adherence → 403", (await get(`/teams/${teamA.id}/adherence`, { user: playerA })).status === 403);
  check("player: review queue → 403", (await get(`/teams/${teamA.id}/review-queue`, { user: playerA })).status === 403);
  check("player: team programs → 403", (await get(`/teams/${teamA.id}/programs`, { user: playerA })).status === 403);
  check('non-member: team detail → 403', (await get(`/teams/${teamA.id}`, { user: playerB })).status === 403);
}

section('E. Day classification (/me/today)');
{
  const on = async (date) => (await get(`/me/today?date=${date}`, { user: playerA })).json;
  const practice = await on('2026-07-20');
  check('practice day classified', practice.dayType === 'PRACTICE_DAY' && practice.routine?.kind === 'practice_warmup', practice.dayType);
  const game = await on('2026-07-25');
  check('game day classified', game.dayType === 'GAME_DAY' && game.routine?.kind === 'game_warmup', game.dayType);
  const off = await on('2026-07-21');
  check('in-season off day → home session', off.dayType === 'IN_SEASON_OFF_DAY' && off.routine?.kind === 'home_session', off.dayType);
  const offSeason = await on('2026-12-25');
  check('off-season classified, program null before generation', offSeason.dayType === 'OFF_SEASON' && offSeason.program === null);
  check('bad date param → 400', (await get('/me/today?date=25-12-2026', { user: playerA })).status === 400);

  const week = await get('/me/week?from=2026-07-20', { user: playerA });
  check(
    'week strip: 7 days classified with events',
    week.status === 200 &&
      week.json.days.length === 7 &&
      week.json.days[0].dayType === 'PRACTICE_DAY' &&
      week.json.days[0].event?.type === 'practice' &&
      week.json.days[5].dayType === 'GAME_DAY',
    JSON.stringify(week.json.days?.map((d) => d.dayType)),
  );
}

section('F. Completions & streaks');
let homeDrillId;
{
  const off = (await get('/me/today?date=2026-07-21', { user: playerA })).json;
  homeDrillId = off.routine.items[0].drill.id;
  const done = await put('/me/completions', { date: '2026-07-21', drillId: homeDrillId, done: true }, { user: playerA });
  check('completion recorded, streak 1', done.status === 200 && done.json.streak === 1 && done.json.drillIds.includes(homeDrillId));
  const undone = await put('/me/completions', { date: '2026-07-21', drillId: homeDrillId, done: false }, { user: playerA });
  check('completion toggled off', undone.status === 200 && undone.json.drillIds.length === 0);
  check('unknown drill → 404', (await put('/me/completions', { date: '2026-07-21', drillId: 'nope', done: true }, { user: playerA })).status === 404);
}

section('G. Video loop: upload → AI draft (coach-only) → coach feedback');
{
  const bytes = VIDEO ? readFileSync(VIDEO) : Buffer.from('not-a-real-video');
  const created = await post('/submissions', { drillId: homeDrillId }, { user: playerA });
  check('submission created', created.status === 201 && !!created.json.uploadUrl);

  const foreign = await req('PUT', created.json.uploadUrl, { user: playerB, rawBody: bytes });
  check("someone else's upload URL → 403", foreign.status === 403, `got ${foreign.status}`);

  const up = await req('PUT', created.json.uploadUrl, { user: playerA, rawBody: bytes });
  check('upload accepted', up.status === 200 && up.json.status === 'ready_for_review');
  check('double upload → 409', (await req('PUT', created.json.uploadUrl, { user: playerA, rawBody: bytes })).status === 409);

  const traversal = await req('PUT', '/uploads/%2e%2e%2f%2e%2e%2fetc%2fpasswd', { user: playerA, rawBody: bytes });
  check('path traversal upload rejected', traversal.status === 404, `got ${traversal.status}`);

  let draft = null;
  for (let i = 0; i < (VIDEO ? 20 : 5) && !draft; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const q = await get(`/teams/${teamA.id}/review-queue`, { user: coachA });
    draft = q.json.items.find((it) => it.id === created.json.id)?.aiDraft ?? null;
  }
  if (VIDEO) {
    check('AI draft lands in coach queue (fake mode)', draft !== null && draft.includes('Focus cue'));
  } else {
    // Undecodable bytes: the pipeline must degrade safely — never fabricate.
    check('unanalyzable video → no AI draft, queue still works', draft === null);
  }

  const mine = await get('/me/submissions', { user: playerA });
  const leaked = mine.json.submissions.some((s) => s.feedback.some((f) => f.author === 'ai'));
  check('AI draft never leaks to the player', !leaked);

  const selfFeedback = await post(`/submissions/${created.json.id}/feedback`, { body: 'gg' }, { user: playerA });
  check('player cannot feedback own video', selfFeedback.status === 403);
  const foreignCoach = await post(`/submissions/${created.json.id}/feedback`, { body: 'gg' }, { user: coachB });
  check("other team's coach cannot feedback", foreignCoach.status === 403);
  const foreignView = await get(`/submissions/${created.json.id}/video`, { user: coachB });
  check("other team's coach cannot watch video", foreignView.status === 403);

  const fb = await post(`/submissions/${created.json.id}/feedback`, { body: 'Nice head position — keep the knees bent.' }, { user: coachA });
  check('coach sends feedback', fb.status === 201);
  const after = await get('/me/submissions', { user: playerA });
  const sub = after.json.submissions.find((s) => s.id === created.json.id);
  check('player sees coach feedback, status reviewed', sub.status === 'reviewed' && sub.feedback.some((f) => f.author === 'coach'));
}

section('H. Guardian accounts & consent lifecycle');
let child;
{
  const bad = await post('/me/children', { name: 'Uncle Bob', birthdate: '1990-01-01' }, { user: parent });
  check('adult birthdate rejected (4-17 only)', bad.status === 400);

  const c = await post('/me/children', { name: 'Audit Kid', birthdate: '2016-05-01' }, { user: parent });
  check('child profile created', c.status === 201 && c.json.age === 10);
  child = c.json;

  const childMakesChild = await post('/me/children', { name: 'Grandkid', birthdate: '2018-01-01' }, { user: child.id });
  check('child profile cannot manage children', childMakesChild.status === 403);

  const join = await post('/teams/join', { joinCode: teamA.joinCode }, { user: parent, child: child.id });
  check('guardian joins child to team (acting)', join.status === 200);

  const today = await get('/me/today?date=2026-07-20', { user: parent, child: child.id });
  check("guardian views child's Today", today.status === 200 && today.json.team?.id === teamA.id);
  check('non-guardian cannot act for child', (await get('/me/today', { user: coachA, child: child.id })).status === 403);
  check('non-guardian cannot grant consent', (await put(`/me/children/${child.id}/consent`, { videoUploads: true }, { user: coachA })).status === 403);

  const blocked = await post('/submissions', { drillId: homeDrillId }, { user: parent, child: child.id });
  check('under-13 upload blocked without consent', blocked.status === 403 && blocked.json.error === 'consent_required');

  const grant = await put(`/me/children/${child.id}/consent`, { videoUploads: true }, { user: parent });
  check('guardian grants consent', grant.status === 200 && grant.json.videoConsentAt !== null);

  const ok = await post('/submissions', { drillId: homeDrillId }, { user: parent, child: child.id });
  check('upload allowed after consent', ok.status === 201);
  const bytes = readFileSync(VIDEO);
  const upload = await req('PUT', ok.json.uploadUrl, { user: parent, child: child.id, rawBody: bytes });
  check('child video bytes accepted (acting)', upload.status === 200);

  // Revocation must also close the pending-upload window (audit fix).
  const pending = await post('/submissions', { drillId: homeDrillId }, { user: parent, child: child.id });
  await put(`/me/children/${child.id}/consent`, { videoUploads: false }, { user: parent });
  const lateBytes = await req('PUT', pending.json.uploadUrl, { user: parent, child: child.id, rawBody: bytes });
  check('revocation closes the pending-upload window', lateBytes.status === 403, `got ${lateBytes.status}`);
  check('post-revocation new submission blocked', (await post('/submissions', { drillId: homeDrillId }, { user: parent, child: child.id })).status === 403);
}

section('I. Off-season programs: generation, guardrails, coach editing');
{
  const shortWin = await post('/me/program', { startsOn: '2026-12-01', endsOn: '2026-12-20', age: 12, focusAreas: ['Strength'], daysPerWeek: 4 }, { user: playerA });
  check('too-short window → 400', shortWin.status === 400);
  const badFocus = await post('/me/program', { startsOn: '2026-12-01', endsOn: '2027-02-22', age: 12, focusAreas: ['Fighting'], daysPerWeek: 4 }, { user: playerA });
  check('unknown focus area → 400', badFocus.status === 400);

  // playerA has no birthdate → body age (12, U13, cap 4) applies.
  const progA = await post('/me/program', { startsOn: '2026-12-01', endsOn: '2027-02-22', age: 12, focusAreas: ['Strength', 'Agility'], daysPerWeek: 6 }, { user: playerA });
  const maxA = Math.max(...progA.json.program.plan.phases.map((p) => Object.values(p.days).filter(Boolean).length));
  check('no-birthdate user: body age honored (U13 caps 6→4 days)', progA.status === 201 && maxA === 4, `max ${maxA}`);

  // Child (age 10 by birthdate) — body lies age 17; birthdate must win (U13 cap 4).
  const progC = await post('/me/program', { startsOn: '2026-12-01', endsOn: '2027-02-22', age: 17, focusAreas: ['Stickhandling'], daysPerWeek: 6 }, { user: parent, child: child.id });
  const maxC = Math.max(...progC.json.program.plan.phases.map((p) => Object.values(p.days).filter(Boolean).length));
  check('birthdate overrides client age for guardrails', progC.status === 201 && maxC === 4, `max ${maxC}`);

  const trainDay = await get('/me/today?date=2026-12-21', { user: playerA }); // Mon, base phase
  check('training-day slice served', trainDay.json.program?.session !== null);
  const sunday = await get('/me/today?date=2026-12-20', { user: playerA });
  check('Sunday is always rest', sunday.json.program?.session === null);

  const progId = progA.json.program.id;
  const restEdit = await put(`/programs/${progId}/phases/1/days/0`, { title: 'X', items: [{ name: 'Squats', detail: 'Down.' }] }, { user: coachA });
  check('coach edit of rest day → 409', restEdit.status === 409);
  const banned = await put(`/programs/${progId}/phases/1/days/1`, { title: 'X', items: [{ name: 'Barbell squats', detail: 'Heavy.', sets: 3, reps: 8 }] }, { user: coachA });
  check('coach edit with banned term → 400', banned.status === 400);
  check('player cannot edit own plan', (await put(`/programs/${progId}/phases/1/days/1`, { title: 'X', items: [{ name: 'Squats', detail: 'Down.' }] }, { user: playerA })).status === 403);
  check("other team's coach cannot edit", (await put(`/programs/${progId}/phases/1/days/1`, { title: 'X', items: [{ name: 'Squats', detail: 'Down.' }] }, { user: coachB })).status === 403);

  const edit = await put(`/programs/${progId}/phases/1/days/1`, { title: 'Coach special', items: [{ name: 'Skater hops', detail: 'Land soft.', sets: 3, reps: 8 }] }, { user: coachA });
  check('valid coach edit accepted', edit.status === 200);
  const seen = await get('/me/today?date=2026-12-21', { user: playerA });
  check('player sees coachEdited session', seen.json.program.session.title === 'Coach special' && seen.json.program.session.coachEdited === true);

  // A plan-less roster player so the board shows both states.
  const bench = await signup('Audit Benchwarmer', 'player');
  await post('/teams/join', { joinCode: teamA.joinCode }, { user: bench });
  // Program items are checkable and feed the same streak as drills.
  const itemDone = await put('/me/completions', { date: '2026-12-21', programItem: 0, done: true }, { user: playerA });
  check(
    'program item checked; streak counts it',
    itemDone.status === 200 && itemDone.json.programItems.includes(0) && itemDone.json.streak >= 1,
    JSON.stringify(itemDone.json),
  );
  check('out-of-range program item → 409', (await put('/me/completions', { date: '2026-12-21', programItem: 99, done: true }, { user: playerA })).status === 409);
  check('rest-day program item → 409', (await put('/me/completions', { date: '2026-12-20', programItem: 0, done: true }, { user: playerA })).status === 409);
  check('no active program → 404', (await put('/me/completions', { date: '2026-12-21', programItem: 0, done: true }, { user: playerB })).status === 404);
  check('drillId and programItem together → 400', (await put('/me/completions', { date: '2026-12-21', drillId: 'x', programItem: 0, done: true }, { user: playerA })).status === 400);
  const itemUndone = await put('/me/completions', { date: '2026-12-21', programItem: 0, done: false }, { user: playerA });
  check('program item toggled off', itemUndone.status === 200 && itemUndone.json.programItems.length === 0);

  const board = await get(`/teams/${teamA.id}/programs?date=2026-12-21`, { user: coachA });
  const rows = board.json.players;
  check(
    'coach board lists plan-holders first',
    rows[0].program !== null && rows[rows.length - 1].program === null,
    rows.map((r) => `${r.playerName}:${r.program ? 'plan' : 'none'}`).join(','),
  );
}

section('J. ICS import: connect, idempotent re-sync, corrections, feed health');
{
  const connect = await put(`/teams/${teamA.id}/ics`, { url: 'http://127.0.0.1:3999/cal.ics' }, { user: coachA });
  check('feed connected, events imported', connect.status === 200 && connect.json.created === 2, JSON.stringify(connect.json));

  const resync = await post(`/teams/${teamA.id}/ics/sync`, undefined, { user: coachA });
  check('re-sync is idempotent', resync.status === 200 && resync.json.created === 0 && resync.json.updated === 0, JSON.stringify(resync.json));

  const sched = await get(`/teams/${teamA.id}/schedule?from=2026-07-13&to=2026-07-19`, { user: coachA });
  const imported = sched.json.events.find((e) => e.source === 'ics' && e.type === 'practice');
  check('imported practice classified by title', !!imported);
  const importedGame = sched.json.events.find((e) => e.source === 'ics' && e.type === 'game');
  check('imported "vs." event classified as game', !!importedGame);

  // Coach correction survives a re-sync that also moves the event.
  await req('PATCH', `/events/${imported.id}`, { user: coachA, body: { type: 'game' } });
  await fetch('http://127.0.0.1:3999/move');
  const moveSync = await post(`/teams/${teamA.id}/ics/sync`, undefined, { user: coachA });
  check('moved event updates on re-sync', moveSync.json.updated === 1, JSON.stringify(moveSync.json));
  const after = await get(`/teams/${teamA.id}/schedule?from=2026-07-13&to=2026-07-19`, { user: coachA });
  const corrected = after.json.events.find((e) => e.id === imported.id);
  check('coach type correction survives re-sync', corrected.type === 'game' && corrected.startsAt === '2026-07-14T19:00:00.000Z');

  await fetch('http://127.0.0.1:3999/break');
  const failSync = await post(`/teams/${teamA.id}/ics/sync`, undefined, { user: coachA });
  check('broken feed sync → 422', failSync.status === 422);
  const health = await get(`/teams/${teamA.id}`, { user: coachA });
  check('feed health records the failure', health.json.feed.status === 'error' && !!health.json.feed.error);
  await fetch('http://127.0.0.1:3999/fix');
  await post(`/teams/${teamA.id}/ics/sync`, undefined, { user: coachA });
  const healthy = await get(`/teams/${teamA.id}`, { user: coachA });
  check('feed health recovers', healthy.json.feed.status === 'ok');

  const bad = await put(`/teams/${teamA.id}/ics`, { url: 'http://127.0.0.1:3999/missing.ics' }, { user: coachA });
  check('unreachable feed → 422, not stored', bad.status === 422);
}

// ---------------------------------------------------------------------------
fixture.close();
console.log(`\n${'='.repeat(60)}`);
console.log(`AUDIT RESULT: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAILED: ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
