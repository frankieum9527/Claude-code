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

export type MembershipRole = 'player' | 'coach';

export interface MembershipDto {
  teamId: string;
  role: MembershipRole;
  team: TeamDto;
}

/** Response of GET /me — who am I and which teams am I on. */
export interface MeResponse {
  user: UserDto;
  memberships: MembershipDto[];
}

export interface TeamMemberDto {
  userId: string;
  name: string;
  membershipRole: MembershipRole;
}

/** Response of GET /teams/:teamId — the coach management view's data. */
export interface TeamDetailResponse {
  team: TeamDto;
  members: TeamMemberDto[];
  seasons: SeasonDto[];
  feed: {
    icsUrl: string | null;
    icsGamesUrl: string | null;
    /** 'ok' | 'error' | null (never synced) */
    status: string | null;
    error: string | null;
    lastSyncedAt: string | null;
  };
}

/** Response of GET /teams/:teamId/schedule. */
export interface ScheduleResponse {
  from: string;
  to: string;
  events: ScheduleEventDto[];
}

/** Dev-mode only: selectable demo personas (GET /auth/dev-personas). */
export interface DevPersonaDto {
  id: string;
  name: string;
  role: Role;
  teams: { name: string; membershipRole: MembershipRole }[];
}

export interface DevPersonasResponse {
  personas: DevPersonaDto[];
}

// ---------------------------------------------------------------------------
// Video submissions (Phase 2)
// ---------------------------------------------------------------------------

export type SubmissionStatus = 'pending_upload' | 'ready_for_review' | 'reviewed';

export interface FeedbackDto {
  id: string;
  author: 'coach' | 'ai';
  authorName: string | null;
  body: string;
  createdAt: string;
}

export interface SubmissionDto {
  id: string;
  status: SubmissionStatus;
  createdAt: string;
  drill: { id: string; title: string };
  feedback: FeedbackDto[];
}

/** Response of POST /submissions — PUT the video bytes to uploadUrl. */
export interface CreateSubmissionResponse {
  id: string;
  uploadUrl: string;
}

export interface MySubmissionsResponse {
  submissions: SubmissionDto[];
}

export interface ReviewQueueItemDto {
  id: string;
  playerName: string;
  drillTitle: string;
  createdAt: string;
}

export interface ReviewQueueResponse {
  items: ReviewQueueItemDto[];
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
