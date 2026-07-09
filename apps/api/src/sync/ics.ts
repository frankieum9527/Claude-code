/**
 * ICS calendar-feed import (docs/ARCHITECTURE.md §5).
 *
 * One adapter covers TeamSnap, SportsEngine, Spond, BenchApp, etc. — they all
 * publish iCalendar subscription URLs (TeamSnap's look like
 * webcal://ical-cdn.teamsnap.com/team_schedule/<token>.ics).
 *
 * Sync is idempotent: events are keyed by their ICS UID (`externalId`).
 * Re-syncs create new events, update moved ones, and remove events that
 * disappeared from the feed — but never touch manually created events, and
 * never overwrite `type`, so a coach's game/practice correction survives.
 */
import ical from 'node-ical';
import { prisma } from '../db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ParsedIcsEvent {
  externalId: string;
  title: string;
  startsAt: Date;
  location: string | null;
}

export interface IcsImportResult {
  created: number;
  updated: number;
  removed: number;
  /** Feed events that fall outside every season window (season must exist first). */
  skippedNoSeason: number;
}

export function parseIcsEvents(icsText: string): ParsedIcsEvent[] {
  const parsed = ical.sync.parseICS(icsText);
  const events: ParsedIcsEvent[] = [];
  for (const item of Object.values(parsed)) {
    if (!item || item.type !== 'VEVENT') continue;
    const ev = item as ical.VEvent;
    if (!ev.uid || !ev.start) continue;
    events.push({
      externalId: String(ev.uid),
      title: typeof ev.summary === 'string' ? ev.summary : '',
      startsAt: new Date(ev.start),
      location: ev.location ? String(ev.location) : null,
    });
  }
  return events;
}

/**
 * Game vs practice. A games-only companion feed (TeamSnap offers one) is
 * authoritative when provided; otherwise fall back to title heuristics —
 * "vs. Wildcats", "@ Ice Hawks", "Game 3" are games, the rest practices.
 * Heuristic misses are fixable via PATCH /events/:id (preserved on re-sync).
 */
const GAME_TITLE_RE = /(^|\s)(vs\.?|@)(\s|$)|\bgame\b/i;

export function classifyEventType(
  title: string,
  externalId: string,
  gameUids?: Set<string>,
): 'game' | 'practice' {
  if (gameUids) return gameUids.has(externalId) ? 'game' : 'practice';
  return GAME_TITLE_RE.test(title) ? 'game' : 'practice';
}

/** webcal:// is https:// by another name; also guard against non-http(s) and private hosts. */
export function normalizeIcsUrl(raw: string): string {
  const url = new URL(raw.trim().replace(/^webcal:\/\//i, 'https://'));
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }
  if (isPrivateHost(url.hostname) && process.env.ALLOW_LOCAL_ICS !== '1') {
    throw new Error('Feed URL must be a public host');
  }
  return url.toString();
}

function isPrivateHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

export async function fetchIcs(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
    headers: { accept: 'text/calendar, text/plain, */*' },
  });
  if (!res.ok) throw new Error(`Feed responded ${res.status}`);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) {
    throw new Error('URL did not return an iCalendar file');
  }
  return text;
}

export async function importIcsToTeam(
  teamId: string,
  icsText: string,
  gamesIcsText?: string,
): Promise<IcsImportResult> {
  const feed = parseIcsEvents(icsText);
  const gameUids = gamesIcsText
    ? new Set(parseIcsEvents(gamesIcsText).map((e) => e.externalId))
    : undefined;

  const seasons = await prisma.season.findMany({ where: { teamId } });
  // Season windows are inclusive date bounds stored as midnight UTC, so an
  // event on the end date (e.g. 18:00) is still in-season: [startsOn, endsOn + 1d)
  const seasonFor = (d: Date) =>
    seasons.find(
      (s) => d.getTime() >= s.startsOn.getTime() && d.getTime() < s.endsOn.getTime() + DAY_MS,
    );

  const existing = await prisma.scheduleEvent.findMany({
    where: { source: 'ics', season: { teamId } },
  });
  const existingByExt = new Map(existing.map((e) => [e.externalId, e]));

  const result: IcsImportResult = { created: 0, updated: 0, removed: 0, skippedNoSeason: 0 };
  const seen = new Set<string>();

  for (const ev of feed) {
    const season = seasonFor(ev.startsAt);
    if (!season) {
      result.skippedNoSeason++;
      continue;
    }
    seen.add(ev.externalId);
    const prev = existingByExt.get(ev.externalId);
    if (!prev) {
      await prisma.scheduleEvent.create({
        data: {
          seasonId: season.id,
          type: classifyEventType(ev.title, ev.externalId, gameUids),
          title: ev.title,
          startsAt: ev.startsAt,
          location: ev.location,
          source: 'ics',
          externalId: ev.externalId,
        },
      });
      result.created++;
    } else {
      const changed =
        prev.startsAt.getTime() !== ev.startsAt.getTime() ||
        prev.location !== ev.location ||
        prev.title !== ev.title ||
        prev.seasonId !== season.id;
      if (changed) {
        // `type` deliberately not updated: coach corrections win over heuristics.
        await prisma.scheduleEvent.update({
          where: { id: prev.id },
          data: {
            startsAt: ev.startsAt,
            location: ev.location,
            title: ev.title,
            seasonId: season.id,
          },
        });
        result.updated++;
      }
    }
  }

  const gone = existing.filter((e) => e.externalId && !seen.has(e.externalId));
  if (gone.length > 0) {
    await prisma.scheduleEvent.deleteMany({ where: { id: { in: gone.map((e) => e.id) } } });
    result.removed = gone.length;
  }

  return result;
}

/** Fetch the team's stored feed(s) and import. */
export async function syncTeamIcs(teamId: string): Promise<IcsImportResult> {
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team?.icsUrl) throw new Error('Team has no calendar feed configured');
  const [icsText, gamesText] = await Promise.all([
    fetchIcs(team.icsUrl),
    team.icsGamesUrl ? fetchIcs(team.icsGamesUrl) : Promise.resolve(undefined),
  ]);
  return importIcsToTeam(teamId, icsText, gamesText);
}
