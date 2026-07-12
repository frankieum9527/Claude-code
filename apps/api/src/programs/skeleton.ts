import type { ProgramPlanDto, TodayProgramDto } from '@athlete-guide/shared-types';

/**
 * The periodized skeleton of an off-season program. Code owns the structure —
 * phase order, date math, and which weekdays train — so every generated plan
 * is a sound periodization regardless of what the AI writes into it
 * (docs/ARCHITECTURE.md §7). The AI (or the stock filler) only supplies the
 * session contents inside this frame.
 */

export const MIN_WINDOW_DAYS = 28; // below 4 weeks there's no room to periodize
export const MAX_WINDOW_DAYS = 280; // ~9 months — longer than any real off-season

export type PhaseKey = 'recovery' | 'base' | 'skills' | 'ramp';

export interface SkeletonPhase {
  key: PhaseKey;
  name: string;
  emphasis: string;
  /** Inclusive ISO dates. */
  startsOn: string;
  endsOn: string;
  /** Weekdays with a session, 0 (Sunday) … 6 (Saturday). Others are rest. */
  trainingWeekdays: number[];
}

export interface Skeleton {
  startsOn: string;
  endsOn: string;
  phases: SkeletonPhase[];
}

/** Phase order and share of the window (shares sum to 1). */
const PHASE_TEMPLATE: { key: PhaseKey; name: string; emphasis: string; share: number }[] = [
  {
    key: 'recovery',
    name: 'Recovery',
    emphasis: 'Rest, mobility, and fun off-ice activity — let the body reset.',
    share: 0.15,
  },
  {
    key: 'base',
    name: 'Strength base',
    emphasis: 'Build the athletic engine: strength, core, and movement quality.',
    share: 0.35,
  },
  {
    key: 'skills',
    name: 'Skills + strength',
    emphasis: 'Keep the strength work and layer in stickhandling and shooting volume.',
    share: 0.3,
  },
  {
    key: 'ramp',
    name: 'Pre-season ramp',
    emphasis: 'Sharpen conditioning and game-speed skills for tryouts and the new season.',
    share: 0.2,
  },
];

/** Spread N weekly sessions across the week with rest days between them. */
const WEEKDAY_PATTERNS: Record<number, number[]> = {
  1: [3], //                    Wed
  2: [1, 4], //                 Mon Thu
  3: [1, 3, 5], //              Mon Wed Fri
  4: [1, 2, 4, 5], //           Mon Tue Thu Fri
  5: [1, 2, 3, 5, 6], //        Mon–Wed Fri Sat
  6: [1, 2, 3, 4, 5, 6], //     Mon–Sat (Sunday always rests)
};

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive day count between two ISO dates. */
export function windowDays(startsOn: string, endsOn: string): number {
  const ms =
    new Date(`${endsOn}T00:00:00.000Z`).getTime() -
    new Date(`${startsOn}T00:00:00.000Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export interface SkeletonInput {
  startsOn: string;
  endsOn: string;
  /** Desired training days per week; the caller clamps this to age guardrails. */
  daysPerWeek: number;
}

/**
 * Split the off-season window into contiguous phases covering it exactly.
 * The recovery phase trains at most 3 days/week no matter what was asked —
 * its whole point is doing less.
 */
export function buildSkeleton({ startsOn, endsOn, daysPerWeek }: SkeletonInput): Skeleton {
  const total = windowDays(startsOn, endsOn);
  if (total < MIN_WINDOW_DAYS || total > MAX_WINDOW_DAYS) {
    throw new Error(`window must be ${MIN_WINDOW_DAYS}-${MAX_WINDOW_DAYS} days, got ${total}`);
  }
  const days = Math.min(6, Math.max(1, Math.floor(daysPerWeek)));

  const phases: SkeletonPhase[] = [];
  let consumed = 0;
  let cumulative = 0;
  for (const [i, tpl] of PHASE_TEMPLATE.entries()) {
    cumulative += tpl.share;
    // Cumulative rounding keeps phases contiguous and the sum exact.
    const end = i === PHASE_TEMPLATE.length - 1 ? total : Math.round(total * cumulative);
    const length = Math.max(1, end - consumed);
    phases.push({
      key: tpl.key,
      name: tpl.name,
      emphasis: tpl.emphasis,
      startsOn: shiftDate(startsOn, consumed),
      endsOn: shiftDate(startsOn, consumed + length - 1),
      trainingWeekdays: WEEKDAY_PATTERNS[tpl.key === 'recovery' ? Math.min(days, 3) : days],
    });
    consumed += length;
  }
  return { startsOn, endsOn, phases };
}

/**
 * The Today view's slice of a plan: which phase the date falls in and that
 * weekday's session (null = rest day). Null when the date is outside the plan.
 */
export function todaySlice(plan: ProgramPlanDto, date: string): TodayProgramDto | null {
  const phase = plan.phases.find((p) => p.startsOn <= date && date <= p.endsOn);
  if (!phase) return null;
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return {
    phaseName: phase.name,
    emphasis: phase.emphasis,
    session: phase.days[String(weekday)] ?? null,
  };
}
