import { describe, expect, it } from 'vitest';
import type { ProgramPlanDto } from '@athlete-guide/shared-types';
import { buildSkeleton, shiftDate, todaySlice, windowDays } from './skeleton.js';

describe('windowDays', () => {
  it('counts inclusively', () => {
    expect(windowDays('2026-06-01', '2026-06-01')).toBe(1);
    expect(windowDays('2026-06-01', '2026-06-28')).toBe(28);
  });
});

describe('buildSkeleton', () => {
  const input = { startsOn: '2026-06-01', endsOn: '2026-08-23', daysPerWeek: 4 }; // 84 days

  it('rejects windows too short to periodize', () => {
    expect(() =>
      buildSkeleton({ startsOn: '2026-06-01', endsOn: '2026-06-20', daysPerWeek: 3 }),
    ).toThrow(/window/);
  });

  it('produces four contiguous phases covering the window exactly', () => {
    const s = buildSkeleton(input);
    expect(s.phases.map((p) => p.key)).toEqual(['recovery', 'base', 'skills', 'ramp']);
    expect(s.phases[0].startsOn).toBe(input.startsOn);
    expect(s.phases[3].endsOn).toBe(input.endsOn);
    for (let i = 1; i < s.phases.length; i++) {
      expect(s.phases[i].startsOn).toBe(shiftDate(s.phases[i - 1].endsOn, 1));
    }
  });

  it('sizes phases by their shares', () => {
    const s = buildSkeleton(input); // 84 days: 15% / 35% / 30% / 20%
    const lengths = s.phases.map((p) => windowDays(p.startsOn, p.endsOn));
    expect(lengths).toEqual([13, 29, 25, 17]);
    expect(lengths.reduce((a, b) => a + b)).toBe(84);
  });

  it('caps the recovery phase at 3 sessions even for high-volume athletes', () => {
    const s = buildSkeleton({ ...input, daysPerWeek: 6 });
    expect(s.phases[0].trainingWeekdays).toHaveLength(3);
    expect(s.phases[1].trainingWeekdays).toHaveLength(6);
  });

  it('never trains on Sunday', () => {
    const s = buildSkeleton({ ...input, daysPerWeek: 6 });
    for (const phase of s.phases) expect(phase.trainingWeekdays).not.toContain(0);
  });
});

describe('todaySlice', () => {
  const plan: ProgramPlanDto = {
    summary: 'test',
    phases: [
      {
        name: 'Recovery',
        emphasis: 'reset',
        startsOn: '2026-06-01',
        endsOn: '2026-06-14',
        // 2026-06-01 is a Monday
        days: { '1': { title: 'Easy day', items: [{ name: 'Walk', detail: 'Go.' }] } },
      },
      {
        name: 'Strength base',
        emphasis: 'build',
        startsOn: '2026-06-15',
        endsOn: '2026-07-12',
        days: { '3': { title: 'Lift day', items: [{ name: 'Squat', detail: 'Down.' }] } },
      },
    ],
  };

  it('returns the covering phase and that weekday session', () => {
    expect(todaySlice(plan, '2026-06-08')).toEqual({
      phaseName: 'Recovery',
      emphasis: 'reset',
      session: { title: 'Easy day', items: [{ name: 'Walk', detail: 'Go.' }] },
    });
    expect(todaySlice(plan, '2026-06-17')?.session?.title).toBe('Lift day'); // a Wednesday
  });

  it('returns a null session on rest days', () => {
    expect(todaySlice(plan, '2026-06-07')).toEqual({
      phaseName: 'Recovery',
      emphasis: 'reset',
      session: null,
    });
  });

  it('returns null outside the plan window', () => {
    expect(todaySlice(plan, '2026-05-31')).toBeNull();
    expect(todaySlice(plan, '2026-07-13')).toBeNull();
  });
});
