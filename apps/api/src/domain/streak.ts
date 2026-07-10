/** Consecutive-day training streak, mirrored by the app's stat tile. */

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Count consecutive days with activity ending at `endDate`. A quiet `endDate`
 * itself doesn't break yesterday's run — the athlete just hasn't trained yet
 * today.
 */
export function computeStreak(activeDates: ReadonlySet<string>, endDate: string): number {
  let cursor = activeDates.has(endDate) ? endDate : shiftDate(endDate, -1);
  let streak = 0;
  while (activeDates.has(cursor)) {
    streak++;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}
