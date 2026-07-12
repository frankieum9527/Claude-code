import type { ProgramPlanDto, ProgramSessionDto } from '@athlete-guide/shared-types';
import type { Skeleton } from './skeleton.js';

/**
 * Hard age-based limits on what a generated program may contain. These are
 * enforced in code AFTER generation — the AI is told about them in its prompt,
 * but a plan that violates them is rejected regardless of how it was produced
 * (docs/ARCHITECTURE.md §7). Bands follow common youth long-term-athlete-
 * development guidance: younger athletes get less volume, no external
 * loading, and no maximal efforts.
 */

export interface Guardrails {
  band: string;
  maxDaysPerWeek: number;
  maxItemsPerSession: number;
  maxSets: number;
  maxReps: number;
  /** Cap on a session's summed item durations (items without one count 5). */
  maxSessionMinutes: number;
  /** Case-insensitive substrings that must not appear in any item text. */
  bannedTerms: string[];
}

const NO_MAX_EFFORT = ['1rm', 'one-rep max', 'max effort', 'to failure'];

export function guardrailsForAge(age: number): Guardrails {
  if (age <= 9) {
    return {
      band: 'U10',
      maxDaysPerWeek: 3,
      maxItemsPerSession: 5,
      maxSets: 3,
      maxReps: 15,
      maxSessionMinutes: 35,
      bannedTerms: [...NO_MAX_EFFORT, 'barbell', 'weighted', 'depth jump'],
    };
  }
  if (age <= 12) {
    return {
      band: 'U13',
      maxDaysPerWeek: 4,
      maxItemsPerSession: 6,
      maxSets: 3,
      maxReps: 15,
      maxSessionMinutes: 50,
      bannedTerms: [...NO_MAX_EFFORT, 'barbell', 'depth jump'],
    };
  }
  if (age <= 15) {
    return {
      band: 'U16',
      maxDaysPerWeek: 5,
      maxItemsPerSession: 7,
      maxSets: 4,
      maxReps: 20,
      maxSessionMinutes: 65,
      bannedTerms: NO_MAX_EFFORT,
    };
  }
  return {
    band: 'U18+',
    maxDaysPerWeek: 6,
    maxItemsPerSession: 8,
    maxSets: 5,
    maxReps: 25,
    maxSessionMinutes: 80,
    bannedTerms: NO_MAX_EFFORT,
  };
}

export function sessionMinutes(session: ProgramSessionDto): number {
  return session.items.reduce((sum, item) => sum + (item.durationMin ?? 5), 0);
}

/**
 * Check one session against the athlete's guardrails. Used per training day
 * by validatePlan, and directly for coach session edits — a coach's changes
 * obey the same age limits as generated content.
 */
export function validateSession(
  session: ProgramSessionDto,
  g: Guardrails,
  where = 'session',
): string[] {
  const errors: string[] = [];
  if (!session.title.trim()) errors.push(`${where}: untitled session`);
  if (session.items.length === 0 || session.items.length > g.maxItemsPerSession) {
    errors.push(`${where}: ${session.items.length} items (allowed 1-${g.maxItemsPerSession})`);
  }
  if (sessionMinutes(session) > g.maxSessionMinutes) {
    errors.push(`${where}: session exceeds ${g.maxSessionMinutes} minutes`);
  }
  for (const item of session.items) {
    if (!item.name.trim()) errors.push(`${where}: unnamed item`);
    if (item.sets != null && (item.sets < 1 || item.sets > g.maxSets)) {
      errors.push(`${where}: "${item.name}" sets over ${g.maxSets}`);
    }
    if (item.reps != null && (item.reps < 1 || item.reps > g.maxReps)) {
      errors.push(`${where}: "${item.name}" reps over ${g.maxReps}`);
    }
    const text = `${item.name} ${item.detail}`.toLowerCase();
    for (const term of g.bannedTerms) {
      if (text.includes(term)) {
        errors.push(`${where}: "${item.name}" contains banned term "${term}" for ${g.band}`);
      }
    }
  }
  return errors;
}

/**
 * Check a finished plan against the skeleton it was built from and the
 * athlete's guardrails. Returns human-readable violations; an empty array
 * means the plan is safe to store.
 */
export function validatePlan(
  plan: ProgramPlanDto,
  skeleton: Skeleton,
  g: Guardrails,
): string[] {
  const errors: string[] = [];
  if (!plan.summary.trim()) errors.push('summary is empty');
  if (plan.phases.length !== skeleton.phases.length) {
    errors.push(
      `expected ${skeleton.phases.length} phases, got ${plan.phases.length}`,
    );
    return errors; // phase-by-phase checks below would misalign
  }

  for (const [i, phase] of plan.phases.entries()) {
    const bone = skeleton.phases[i];
    const where = `phase "${bone.name}"`;
    if (phase.startsOn !== bone.startsOn || phase.endsOn !== bone.endsOn) {
      errors.push(`${where}: dates differ from the skeleton`);
    }
    for (let weekday = 0; weekday < 7; weekday++) {
      const session = phase.days[String(weekday)] ?? null;
      const shouldTrain = bone.trainingWeekdays.includes(weekday);
      if (!shouldTrain) {
        if (session) errors.push(`${where}: weekday ${weekday} must be a rest day`);
        continue;
      }
      if (!session) {
        errors.push(`${where}: weekday ${weekday} is missing its session`);
        continue;
      }
      errors.push(...validateSession(session, g, `${where}, weekday ${weekday}`));
    }
  }
  return errors;
}
