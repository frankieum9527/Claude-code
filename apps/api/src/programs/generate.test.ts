import { afterEach, describe, expect, it } from 'vitest';
import { generateProgram, stockPlan } from './generate.js';
import { guardrailsForAge, validatePlan } from './guardrails.js';
import { buildSkeleton, todaySlice } from './skeleton.js';

const input = {
  startsOn: '2026-06-01',
  endsOn: '2026-08-23',
  age: 12,
  heightCm: 150,
  weightKg: 42,
  focusAreas: ['Shot power', 'Skating speed'],
  daysPerWeek: 4,
};

afterEach(() => {
  delete process.env.AI_FAKE;
});

describe('stockPlan', () => {
  it('is valid by construction for every age band', () => {
    for (const age of [8, 11, 14, 17]) {
      const g = guardrailsForAge(age);
      const skeleton = buildSkeleton({
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        daysPerWeek: Math.min(input.daysPerWeek, g.maxDaysPerWeek),
      });
      const plan = stockPlan({ ...input, age }, skeleton, g);
      expect(validatePlan(plan, skeleton, g)).toEqual([]);
    }
  });

  it('rotates through the athlete’s focus areas within a phase', () => {
    const g = guardrailsForAge(input.age);
    const skeleton = buildSkeleton({ ...input, daysPerWeek: 4 });
    const base = stockPlan(input, skeleton, g).phases[1];
    const titles = Object.values(base.days).flatMap((s) => (s ? [s.title] : []));
    expect(titles.some((t) => t.includes('shot power'))).toBe(true);
    expect(titles.some((t) => t.includes('skating speed'))).toBe(true);
  });

  it('keeps the recovery phase generic and light', () => {
    const g = guardrailsForAge(input.age);
    const skeleton = buildSkeleton({ ...input, daysPerWeek: 4 });
    const recovery = stockPlan(input, skeleton, g).phases[0];
    const sessions = Object.values(recovery.days).flatMap((s) => (s ? [s] : []));
    expect(sessions.length).toBe(3); // capped below daysPerWeek
    for (const s of sessions) expect(s.title).toBe('Active recovery');
  });
});

describe('generateProgram', () => {
  it('serves the stock plan in fake mode and slices cleanly for Today', async () => {
    process.env.AI_FAKE = '1';
    const { plan, source } = await generateProgram(input);
    expect(source).toBe('stock');
    // 2026-06-22 is a Monday inside the base phase → a training session.
    expect(todaySlice(plan, '2026-06-22')?.session).not.toBeNull();
    // 2026-06-21 is a Sunday → always rest.
    expect(todaySlice(plan, '2026-06-21')?.session).toBeNull();
  });

  it('clamps requested volume to the age band', async () => {
    process.env.AI_FAKE = '1';
    const { plan } = await generateProgram({ ...input, age: 8, daysPerWeek: 6 });
    const g = guardrailsForAge(8);
    for (const phase of plan.phases) {
      const sessions = Object.values(phase.days).filter((s) => s !== null);
      expect(sessions.length).toBeLessThanOrEqual(g.maxDaysPerWeek);
    }
  });
});
