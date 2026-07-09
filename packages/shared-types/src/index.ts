/**
 * Domain types shared between the API and the mobile/web clients.
 * These mirror docs/ARCHITECTURE.md §3 (data model) and §4 (day classification).
 */

export type Role = 'player' | 'coach' | 'parent';

/** Content is keyed by sport; adding a sport extends this union. */
export type Sport = 'hockey';

export type EventType = 'practice' | 'game';

export type DayType =
  | 'GAME_DAY'
  | 'PRACTICE_DAY'
  | 'IN_SEASON_OFF_DAY'
  | 'OFF_SEASON';

export type RoutineKind = 'practice_warmup' | 'game_warmup' | 'home_session';

/** Which routine kind serves each day type (OFF_SEASON is program-driven later). */
export const ROUTINE_KIND_FOR_DAY: Record<DayType, RoutineKind | null> = {
  GAME_DAY: 'game_warmup',
  PRACTICE_DAY: 'practice_warmup',
  IN_SEASON_OFF_DAY: 'home_session',
  OFF_SEASON: null,
};

// ---------------------------------------------------------------------------
// API DTOs
// ---------------------------------------------------------------------------

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface TeamDto {
  id: string;
  name: string;
  sport: Sport;
  joinCode: string;
}

export interface SeasonDto {
  id: string;
  teamId: string;
  name: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  startsOn: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  endsOn: string;
}

export interface ScheduleEventDto {
  id: string;
  seasonId: string;
  type: EventType;
  /** Feed summary for imported events, e.g. "vs. Wildcats". */
  title: string | null;
  /** ISO 8601 timestamp. */
  startsAt: string;
  location: string | null;
  source: 'manual' | 'ics';
}

export interface DrillDto {
  id: string;
  sport: Sport;
  title: string;
  description: string;
  videoUrl: string | null;
}

export interface RoutineItemDto {
  drill: DrillDto;
  position: number;
  durationSec: number | null;
}

export interface RoutineDto {
  id: string;
  kind: RoutineKind;
  sport: Sport;
  title: string;
  items: RoutineItemDto[];
}

/** Response of GET /me/today — everything the player's Today view needs. */
export interface TodayResponse {
  /** ISO date the classification is for. */
  date: string;
  dayType: DayType;
  team: TeamDto | null;
  season: SeasonDto | null;
  /** Today's schedule events (empty on off days / off-season). */
  events: ScheduleEventDto[];
  /** The routine to show, per ROUTINE_KIND_FOR_DAY. Null in off-season until programs ship. */
  routine: RoutineDto | null;
}
