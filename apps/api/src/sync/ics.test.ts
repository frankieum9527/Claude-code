import { describe, expect, it } from 'vitest';
import { classifyEventType, normalizeIcsUrl, parseIcsEvents } from './ics.js';

// TeamSnap-shaped fixture (synthetic data): games-vs-practice titles, TZID and
// UTC timestamps, a folded SUMMARY line, and an escaped comma in LOCATION.
const FIXTURE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//TeamSnap//TeamSnap Calendar//EN',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:Riverside Ravens',
  'BEGIN:VEVENT',
  'UID:event-1001@teamsnap.com',
  'DTSTAMP:20260701T120000Z',
  'DTSTART;TZID=America/New_York:20260714T180000',
  'DTEND;TZID=America/New_York:20260714T190000',
  'SUMMARY:Practice',
  'LOCATION:Riverside Arena\\, Rink B',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-1002@teamsnap.com',
  'DTSTAMP:20260701T120000Z',
  'DTSTART:20260718T150000Z',
  'DTEND:20260718T170000Z',
  'SUMMARY:vs. Wildcats — Summer Classic Tournament Pool Play Round One Ope',
  ' ning Matchup',
  'LOCATION:Central Ice Complex',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-1003@teamsnap.com',
  'DTSTAMP:20260701T120000Z',
  'DTSTART:20260721T230000Z',
  'SUMMARY:@ Ice Hawks',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('parseIcsEvents', () => {
  const events = parseIcsEvents(FIXTURE);

  it('extracts every VEVENT with uid, title, start, location', () => {
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      externalId: 'event-1001@teamsnap.com',
      title: 'Practice',
      location: 'Riverside Arena, Rink B',
    });
  });

  it('converts TZID timestamps to the right instant (18:00 EDT = 22:00 UTC)', () => {
    expect(events[0].startsAt.toISOString()).toBe('2026-07-14T22:00:00.000Z');
  });

  it('unfolds wrapped SUMMARY lines', () => {
    expect(events[1].title).toBe(
      'vs. Wildcats — Summer Classic Tournament Pool Play Round One Opening Matchup',
    );
  });

  it('handles events without a location', () => {
    expect(events[2].location).toBeNull();
  });
});

describe('classifyEventType', () => {
  it('classifies by title heuristics when no games feed is given', () => {
    expect(classifyEventType('vs. Wildcats', 'u1')).toBe('game');
    expect(classifyEventType('@ Ice Hawks', 'u2')).toBe('game');
    expect(classifyEventType('Game 3 - Playoffs', 'u3')).toBe('game');
    expect(classifyEventType('Practice', 'u4')).toBe('practice');
    expect(classifyEventType('Dryland training', 'u5')).toBe('practice');
    expect(classifyEventType('Team photos', 'u6')).toBe('practice');
  });

  it('treats a games-only feed as authoritative over heuristics', () => {
    const gameUids = new Set(['u1']);
    expect(classifyEventType('Team event', 'u1', gameUids)).toBe('game');
    expect(classifyEventType('vs. Wildcats (scrimmage)', 'u2', gameUids)).toBe('practice');
  });
});

describe('normalizeIcsUrl', () => {
  it('rewrites webcal:// to https://', () => {
    expect(
      normalizeIcsUrl('webcal://ical-cdn.teamsnap.com/team_schedule/abc.ics'),
    ).toBe('https://ical-cdn.teamsnap.com/team_schedule/abc.ics');
  });

  it('rejects non-http protocols', () => {
    expect(() => normalizeIcsUrl('ftp://example.com/cal.ics')).toThrow(/protocol/i);
  });

  it('rejects private hosts unless the dev flag is set', () => {
    expect(() => normalizeIcsUrl('https://192.168.1.5/cal.ics')).toThrow(/public host/i);
  });
});
