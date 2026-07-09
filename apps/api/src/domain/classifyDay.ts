import type { DayType, EventType } from '@athlete-guide/shared-types';

/** Season window with inclusive ISO date bounds (YYYY-MM-DD). */
export interface SeasonWindow {
  startsOn: string;
  endsOn: string;
}

export interface DayEvent {
  type: EventType;
}

/**
 * The core engine (docs/ARCHITECTURE.md §4): classify a calendar day for a
 * player given their team's active season and that day's schedule events.
 *
 * Pure and deterministic — dates are ISO YYYY-MM-DD strings, which compare
 * correctly lexicographically. Game outranks practice when both fall on the
 * same day.
 */
export function classifyDay(
  date: string,
  season: SeasonWindow | null,
  events: DayEvent[],
): DayType {
  if (!season || date < season.startsOn || date > season.endsOn) {
    return 'OFF_SEASON';
  }
  if (events.some((e) => e.type === 'game')) {
    return 'GAME_DAY';
  }
  if (events.some((e) => e.type === 'practice')) {
    return 'PRACTICE_DAY';
  }
  return 'IN_SEASON_OFF_DAY';
}
