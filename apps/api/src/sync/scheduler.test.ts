import { describe, expect, it } from 'vitest';
import { isDueForSync } from './scheduler.js';

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-07-09T12:00:00.000Z');

describe('isDueForSync', () => {
  it('never syncs a team without a feed', () => {
    expect(isDueForSync({ id: 't', icsUrl: null, icsLastSyncedAt: null }, now, HOUR)).toBe(false);
  });

  it('syncs immediately when a feed has never been synced', () => {
    expect(
      isDueForSync({ id: 't', icsUrl: 'https://x/cal.ics', icsLastSyncedAt: null }, now, HOUR),
    ).toBe(true);
  });

  it('is not due when the last sync is within the interval', () => {
    const recent = new Date(now.getTime() - HOUR / 2);
    expect(
      isDueForSync({ id: 't', icsUrl: 'https://x/cal.ics', icsLastSyncedAt: recent }, now, HOUR),
    ).toBe(false);
  });

  it('is due once the interval has elapsed (boundary inclusive)', () => {
    const exactlyOneHourAgo = new Date(now.getTime() - HOUR);
    expect(
      isDueForSync(
        { id: 't', icsUrl: 'https://x/cal.ics', icsLastSyncedAt: exactlyOneHourAgo },
        now,
        HOUR,
      ),
    ).toBe(true);
  });
});
