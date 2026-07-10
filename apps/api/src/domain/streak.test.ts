import { describe, expect, it } from 'vitest';
import { computeStreak } from './streak.js';

describe('computeStreak', () => {
  it('is zero with no activity', () => {
    expect(computeStreak(new Set(), '2026-07-10')).toBe(0);
  });

  it('counts a run ending today', () => {
    const dates = new Set(['2026-07-08', '2026-07-09', '2026-07-10']);
    expect(computeStreak(dates, '2026-07-10')).toBe(3);
  });

  it("a quiet today doesn't break yesterday's run", () => {
    const dates = new Set(['2026-07-08', '2026-07-09']);
    expect(computeStreak(dates, '2026-07-10')).toBe(2);
  });

  it('a gap resets the streak', () => {
    const dates = new Set(['2026-07-06', '2026-07-07', '2026-07-09', '2026-07-10']);
    expect(computeStreak(dates, '2026-07-10')).toBe(2);
  });

  it('two quiet days end the streak', () => {
    const dates = new Set(['2026-07-07', '2026-07-08']);
    expect(computeStreak(dates, '2026-07-10')).toBe(0);
  });

  it('handles month boundaries', () => {
    const dates = new Set(['2026-06-30', '2026-07-01']);
    expect(computeStreak(dates, '2026-07-01')).toBe(2);
  });
});
