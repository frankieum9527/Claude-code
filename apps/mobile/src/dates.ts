/**
 * Date helpers anchored to the DEVICE's local calendar day.
 *
 * The API classifies whichever `?date=` it is given; if the client derived
 * "today" from UTC, every user west of Greenwich would flip to tomorrow's
 * guidance in the evening — exactly when kids do their home sessions. All
 * client requests therefore send the device-local date explicitly.
 * (Per-team timezones are the eventual server-side refinement; see
 * docs/PLAN.md.)
 */

/** Today as YYYY-MM-DD in the device's local timezone. */
export function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Shift a YYYY-MM-DD by whole days (pure calendar math, timezone-free). */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
