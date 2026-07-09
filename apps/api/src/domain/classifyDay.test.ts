import { describe, expect, it } from 'vitest';
import { classifyDay } from './classifyDay.js';

const season = { startsOn: '2026-06-01', endsOn: '2026-08-31' };

describe('classifyDay', () => {
  it('returns OFF_SEASON when there is no season at all', () => {
    expect(classifyDay('2026-07-09', null, [])).toBe('OFF_SEASON');
  });

  it('returns OFF_SEASON before the season starts', () => {
    expect(classifyDay('2026-05-31', season, [])).toBe('OFF_SEASON');
  });

  it('returns OFF_SEASON after the season ends', () => {
    expect(classifyDay('2026-09-01', season, [])).toBe('OFF_SEASON');
  });

  it('treats season bounds as inclusive', () => {
    expect(classifyDay('2026-06-01', season, [])).toBe('IN_SEASON_OFF_DAY');
    expect(classifyDay('2026-08-31', season, [])).toBe('IN_SEASON_OFF_DAY');
  });

  it('returns GAME_DAY when a game is scheduled', () => {
    expect(classifyDay('2026-07-11', season, [{ type: 'game' }])).toBe('GAME_DAY');
  });

  it('prefers GAME_DAY when both a game and a practice fall on the same day', () => {
    expect(
      classifyDay('2026-07-11', season, [{ type: 'practice' }, { type: 'game' }]),
    ).toBe('GAME_DAY');
  });

  it('returns PRACTICE_DAY when only practices are scheduled', () => {
    expect(classifyDay('2026-07-09', season, [{ type: 'practice' }])).toBe('PRACTICE_DAY');
  });

  it('returns IN_SEASON_OFF_DAY for an in-season day with no events', () => {
    expect(classifyDay('2026-07-10', season, [])).toBe('IN_SEASON_OFF_DAY');
  });

  it('ignores events entirely when outside the season window', () => {
    expect(classifyDay('2026-09-05', season, [{ type: 'game' }])).toBe('OFF_SEASON');
  });
});
