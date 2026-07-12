import { describe, expect, it } from 'vitest';
import { ageOn, isUnder13 } from './age.js';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('ageOn', () => {
  it('counts whole years, turning on the birthday itself', () => {
    expect(ageOn(d('2014-03-15'), d('2026-03-14'))).toBe(11);
    expect(ageOn(d('2014-03-15'), d('2026-03-15'))).toBe(12);
    expect(ageOn(d('2014-03-15'), d('2026-03-16'))).toBe(12);
  });

  it('handles month boundaries', () => {
    expect(ageOn(d('2014-12-31'), d('2026-01-01'))).toBe(11);
  });
});

describe('isUnder13', () => {
  it('gates by calendar age, not milliseconds', () => {
    // Turns 13 exactly on 2026-07-01: leap years would break a ms-based check.
    expect(isUnder13(d('2013-07-01'), d('2026-06-30'))).toBe(true);
    expect(isUnder13(d('2013-07-01'), d('2026-07-01'))).toBe(false);
  });

  it('treats missing birthdate as not gated (self-signup adults/teens)', () => {
    expect(isUnder13(null)).toBe(false);
  });
});
