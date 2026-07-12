import { describe, expect, it } from 'vitest';
import type { ProgramPlanDto, ProgramSessionDto } from '@athlete-guide/shared-types';
import { guardrailsForAge, validatePlan, validateSession } from './guardrails.js';
import type { Skeleton } from './skeleton.js';

describe('guardrailsForAge', () => {
  it('maps ages to bands with tightening limits for younger athletes', () => {
    expect(guardrailsForAge(8).band).toBe('U10');
    expect(guardrailsForAge(12).band).toBe('U13');
    expect(guardrailsForAge(15).band).toBe('U16');
    expect(guardrailsForAge(17).band).toBe('U18+');
    expect(guardrailsForAge(8).maxDaysPerWeek).toBeLessThan(guardrailsForAge(17).maxDaysPerWeek);
  });

  it('bans external loading for the youngest band only', () => {
    expect(guardrailsForAge(9).bannedTerms).toContain('weighted');
    expect(guardrailsForAge(14).bannedTerms).not.toContain('weighted');
    // Maximal efforts are banned for everyone.
    expect(guardrailsForAge(17).bannedTerms).toContain('1rm');
  });
});

const skeleton: Skeleton = {
  startsOn: '2026-06-01',
  endsOn: '2026-06-28',
  phases: [
    {
      key: 'base',
      name: 'Strength base',
      emphasis: 'build',
      startsOn: '2026-06-01',
      endsOn: '2026-06-28',
      trainingWeekdays: [1, 3],
    },
  ],
};

const okSession: ProgramSessionDto = {
  title: 'Session',
  items: [{ name: 'Bodyweight squats', detail: 'Heels down.', sets: 3, reps: 10 }],
};

function planWith(days: Record<string, ProgramSessionDto | null>): ProgramPlanDto {
  return {
    summary: 'A plan.',
    phases: [
      {
        name: 'Strength base',
        emphasis: 'build',
        startsOn: '2026-06-01',
        endsOn: '2026-06-28',
        days: { '1': okSession, '3': okSession, ...days },
      },
    ],
  };
}

describe('validatePlan', () => {
  const g = guardrailsForAge(10); // U13: 6 items, 3 sets, 15 reps, 50 min, no barbell

  it('accepts a compliant plan', () => {
    expect(validatePlan(planWith({}), skeleton, g)).toEqual([]);
  });

  it('rejects sessions on rest days and missing sessions on training days', () => {
    expect(validatePlan(planWith({ '0': okSession }), skeleton, g)).toContainEqual(
      expect.stringContaining('must be a rest day'),
    );
    expect(validatePlan(planWith({ '3': null }), skeleton, g)).toContainEqual(
      expect.stringContaining('missing its session'),
    );
  });

  it('rejects banned terms for the band', () => {
    const errors = validatePlan(
      planWith({
        '3': { title: 'S', items: [{ name: 'Barbell squats', detail: 'Heavy.', sets: 3, reps: 5 }] },
      }),
      skeleton,
      g,
    );
    expect(errors).toContainEqual(expect.stringContaining('banned term "barbell"'));
    // The same plan is fine for a 16-year-old.
    expect(
      validatePlan(
        planWith({
          '3': { title: 'S', items: [{ name: 'Barbell squats', detail: 'Heavy.', sets: 3, reps: 5 }] },
        }),
        skeleton,
        guardrailsForAge(16),
      ),
    ).toEqual([]);
  });

  it('rejects volume over the caps', () => {
    const tooManySets = { ...okSession, items: [{ ...okSession.items[0], sets: 5 }] };
    expect(validatePlan(planWith({ '3': tooManySets }), skeleton, g)).toContainEqual(
      expect.stringContaining('sets over 3'),
    );
    const tooLong = {
      title: 'Marathon',
      items: [{ name: 'Bike', detail: 'Forever.', durationMin: 90 }],
    };
    expect(validatePlan(planWith({ '3': tooLong }), skeleton, g)).toContainEqual(
      expect.stringContaining('exceeds 50 minutes'),
    );
    const tooMany = {
      title: 'Everything',
      items: Array.from({ length: 7 }, (_, i) => ({ name: `Move ${i}`, detail: 'Do it.' })),
    };
    expect(validatePlan(planWith({ '3': tooMany }), skeleton, g)).toContainEqual(
      expect.stringContaining('items (allowed 1-6)'),
    );
  });

  it('validateSession is the same gate coach edits pass through', () => {
    const g10 = guardrailsForAge(10);
    expect(validateSession(okSession, g10)).toEqual([]);
    expect(
      validateSession(
        { title: 'S', items: [{ name: 'Barbell rows', detail: 'Heavy.', sets: 3, reps: 8 }] },
        g10,
      ),
    ).toContainEqual(expect.stringContaining('banned term "barbell"'));
    expect(
      validateSession({ title: '', items: [{ name: 'Squats', detail: 'Down.' }] }, g10),
    ).toContainEqual(expect.stringContaining('untitled'));
  });

  it('rejects dates that drift from the skeleton', () => {
    const plan = planWith({});
    plan.phases[0].endsOn = '2026-07-01';
    expect(validatePlan(plan, skeleton, g)).toContainEqual(
      expect.stringContaining('dates differ'),
    );
  });
});
