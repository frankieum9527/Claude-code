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

/** Response of GET/PUT /me/completions — the day's check-offs plus streak. */
export interface CompletionsResponse {
  date: string;
  drillIds: string[];
  streak: number;
}

export interface AdherencePlayerDto {
  userId: string;
  name: string;
  /** Days in the window with at least one completion. */
  activeDays: number;
  completions: number;
  /** ISO date of the most recent completion, if any. */
  lastActiveOn: string | null;
}

/** Response of GET /teams/:teamId/adherence?days=N (coach only). */
export interface AdherenceResponse {
  days: number;
  players: AdherencePlayerDto[];
}

// ---------------------------------------------------------------------------
// Off-season programs (Phase 3)
// ---------------------------------------------------------------------------

export const HOCKEY_FOCUS_AREAS = [
  'Skating speed',
  'Shot power',
  'Stickhandling',
  'Conditioning',
  'Strength',
  'Agility',
] as const;

export interface ProgramItemDto {
  name: string;
  detail: string;
  sets?: number;
  reps?: number;
  durationMin?: number;
}

export interface ProgramSessionDto {
  title: string;
  items: ProgramItemDto[];
  /** True once a coach has adjusted this session; shown to the player. */
  coachEdited?: boolean;
}

export interface ProgramPhaseDto {
  name: string;
  emphasis: string;
  /** Inclusive ISO dates. */
  startsOn: string;
  endsOn: string;
  /** Weekday pattern, keys '0' (Sunday) … '6' (Saturday); null = rest day. */
  days: Record<string, ProgramSessionDto | null>;
}

export interface ProgramPlanDto {
  summary: string;
  phases: ProgramPhaseDto[];
}

export interface ProgramDto {
  id: string;
  sport: Sport;
  status: 'active' | 'archived';
  startsOn: string;
  endsOn: string;
  focusAreas: string[];
  plan: ProgramPlanDto;
  createdAt: string;
}

/** Today-view slice of the active program for an off-season date. */
export interface TodayProgramDto {
  phaseName: string;
  emphasis: string;
  /** Null on rest days. */
  session: ProgramSessionDto | null;
}

/** Body of POST /me/program. */
export interface CreateProgramRequest {
  /** Inclusive ISO dates; the window must be 4 weeks to ~9 months. */
  startsOn: string;
  endsOn: string;
  age: number;
  heightCm?: number;
  weightKg?: number;
  /** 1-3 entries from HOCKEY_FOCUS_AREAS. */
  focusAreas: string[];
  /** Desired training days per week (2-6); clamped to the age band's cap. */
  daysPerWeek: number;
}

/** Response of GET /me/program and POST /me/program. */
export interface ProgramResponse {
  program: ProgramDto | null;
}

/** One roster player's off-season plan, as the coach sees it. */
export interface TeamProgramPlayerDto {
  playerId: string;
  playerName: string;
  /** Null when the player has no active program. */
  program: {
    id: string;
    startsOn: string;
    endsOn: string;
    focusAreas: string[];
    summary: string;
    /** Phase covering the response date; null before/after the plan window. */
    currentPhase: string | null;
    /**
     * The response date's session with its address in the plan (for coach
     * edits via PUT /programs/:id/phases/:phaseIndex/days/:weekday); null on
     * rest days and outside the window.
     */
    today: { phaseIndex: number; weekday: number; session: ProgramSessionDto } | null;
    phases: { name: string; startsOn: string; endsOn: string; sessionsPerWeek: number }[];
  } | null;
}

/** Body of PUT /programs/:programId/phases/:phaseIndex/days/:weekday. */
export interface UpdateProgramSessionRequest {
  title: string;
  items: ProgramItemDto[];
}

/** Response of GET /teams/:teamId/programs (coach only). */
export interface TeamProgramsResponse {
  /** The date currentPhase/todaySession are computed for. */
  date: string;
  players: TeamProgramPlayerDto[];
}

// ---------------------------------------------------------------------------
// Guardian accounts & parental consent (ARCHITECTURE.md §8)
// ---------------------------------------------------------------------------

/** A guardian-managed player profile. Children can't sign in themselves —
 *  the guardian's device acts for them (x-child-id header). */
export interface ChildDto {
  id: string;
  name: string;
  /** ISO date (YYYY-MM-DD). */
  birthdate: string;
  age: number;
  /** When the guardian approved video uploads; null = not approved. */
  videoConsentAt: string | null;
  teams: { teamId: string; name: string }[];
}

/** Body of POST /me/children. */
export interface CreateChildRequest {
  name: string;
  birthdate: string;
}

/** Body of PUT /me/children/:childId/consent. */
export interface SetChildConsentRequest {
  videoUploads: boolean;
}

/** Response of GET /me/children. */
export interface ChildrenResponse {
  children: ChildDto[];
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
  /**
   * AI-drafted feedback for the coach to edit before sending. Never shown to
   * players directly — the coach's (possibly edited) send is what they see.
   */
  aiDraft: string | null;
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
  /** The routine to show, per ROUTINE_KIND_FOR_DAY. Null in off-season. */
  routine: RoutineDto | null;
  /** Off-season only: today's slice of the player's active program. */
  program: TodayProgramDto | null;
}
