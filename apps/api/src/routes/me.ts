import type { FastifyInstance } from 'fastify';
import type {
  MeResponse,
  MembershipRole,
  ProgramPlanDto,
  Role,
  RoutineDto,
  Sport,
  TodayResponse,
  EventType,
  RoutineKind,
  WeekResponse,
} from '@athlete-guide/shared-types';
import { ROUTINE_KIND_FOR_DAY } from '@athlete-guide/shared-types';
import { prisma } from '../db.js';
import { requireActor, requireUser } from '../auth.js';
import { classifyDay } from '../domain/classifyDay.js';
import { shiftDate } from '../domain/streak.js';
import { todaySlice } from '../programs/skeleton.js';
import { todayProgram } from './programs.js';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export async function meRoutes(app: FastifyInstance) {
  // Who am I, and which teams am I on (and in what role)? The app uses this
  // to decide whether to show the coach view.
  app.get('/me', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const memberships = await prisma.teamMembership.findMany({
      where: { userId: user.id },
      include: { team: true },
    });
    const response: MeResponse = {
      user: { id: user.id, name: user.name, email: user.email, role: user.role as Role },
      memberships: memberships.map((m) => ({
        teamId: m.teamId,
        role: m.role as MembershipRole,
        team: {
          id: m.team.id,
          name: m.team.name,
          sport: m.team.sport as Sport,
          joinCode: m.team.joinCode,
        },
      })),
    };
    return reply.send(response);
  });

  /**
   * The player's Today view: classify the day and return the matching
   * schedule + routine. `?date=YYYY-MM-DD` overrides "today" (useful for
   * demos and tests).
   *
   * Day boundaries are UTC for now; per-team timezones are a Phase 1 item
   * (see docs/PLAN.md).
   */
  app.get('/me/today', async (req, reply) => {
    const user = await requireActor(req, reply); // guardians view a child's day
    if (!user) return;

    const { date: dateParam } = req.query as { date?: string };
    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    }
    const date = dateParam ?? isoDate(new Date());

    const membership = await prisma.teamMembership.findFirst({
      where: { userId: user.id },
      include: { team: true },
    });

    // No team yet still counts as off-season — an active program still serves.
    if (!membership) {
      const empty: TodayResponse = {
        date,
        dayType: 'OFF_SEASON',
        team: null,
        season: null,
        events: [],
        routine: null,
        program: await todayProgram(user.id, date),
      };
      return reply.send(empty);
    }
    const team = membership.team;

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const season = await prisma.season.findFirst({
      where: { teamId: team.id, startsOn: { lte: dayStart }, endsOn: { gte: dayStart } },
    });

    const events = season
      ? await prisma.scheduleEvent.findMany({
          where: { seasonId: season.id, startsAt: { gte: dayStart, lt: dayEnd } },
          orderBy: { startsAt: 'asc' },
        })
      : [];

    const dayType = classifyDay(
      date,
      season ? { startsOn: isoDate(season.startsOn), endsOn: isoDate(season.endsOn) } : null,
      events.map((e) => ({ type: e.type as EventType })),
    );

    const kind = ROUTINE_KIND_FOR_DAY[dayType];
    const routine = kind
      ? await prisma.routine.findUnique({
          where: { sport_kind: { sport: team.sport, kind } },
          include: {
            items: { orderBy: { position: 'asc' }, include: { drill: true } },
          },
        })
      : null;

    const routineDto: RoutineDto | null = routine
      ? {
          id: routine.id,
          kind: routine.kind as RoutineKind,
          sport: routine.sport as Sport,
          title: routine.title,
          items: routine.items.map((item) => ({
            position: item.position,
            durationSec: item.durationSec,
            drill: {
              id: item.drill.id,
              sport: item.drill.sport as Sport,
              title: item.drill.title,
              description: item.drill.description,
              videoUrl: item.drill.videoUrl,
            },
          })),
        }
      : null;

    const response: TodayResponse = {
      date,
      dayType,
      team: {
        id: team.id,
        name: team.name,
        sport: team.sport as Sport,
        joinCode: team.joinCode,
      },
      season: season
        ? {
            id: season.id,
            teamId: season.teamId,
            name: season.name,
            startsOn: isoDate(season.startsOn),
            endsOn: isoDate(season.endsOn),
          }
        : null,
      events: events.map((e) => ({
        id: e.id,
        seasonId: e.seasonId,
        type: e.type as EventType,
        title: e.title,
        startsAt: e.startsAt.toISOString(),
        location: e.location,
        source: e.source as 'manual' | 'ics',
      })),
      routine: routineDto,
      // Off-season days are program-driven (docs/ARCHITECTURE.md §7).
      program: dayType === 'OFF_SEASON' ? await todayProgram(user.id, date) : null,
    };
    return reply.send(response);
  });

  /**
   * Seven days from `?from=` (default: server today) classified the same way
   * as /me/today, plus the day's first event and whether the active program
   * schedules a session — the Today view's week-at-a-glance strip.
   */
  app.get('/me/week', async (req, reply) => {
    const user = await requireActor(req, reply);
    if (!user) return;
    const { from: fromParam } = req.query as { from?: string };
    if (fromParam && !/^\d{4}-\d{2}-\d{2}$/.test(fromParam)) {
      return reply.code(400).send({ error: 'from must be YYYY-MM-DD' });
    }
    const from = fromParam ?? isoDate(new Date());
    const windowStart = new Date(`${from}T00:00:00.000Z`);
    const windowEnd = new Date(windowStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const membership = await prisma.teamMembership.findFirst({
      where: { userId: user.id },
      include: { team: true },
    });
    const seasons = membership
      ? await prisma.season.findMany({
          where: {
            teamId: membership.team.id,
            startsOn: { lt: windowEnd },
            endsOn: { gte: windowStart },
          },
        })
      : [];
    const events =
      seasons.length > 0
        ? await prisma.scheduleEvent.findMany({
            where: {
              seasonId: { in: seasons.map((s) => s.id) },
              startsAt: { gte: windowStart, lt: windowEnd },
            },
            orderBy: { startsAt: 'asc' },
          })
        : [];
    const program = await prisma.program.findFirst({
      where: {
        playerId: user.id,
        status: 'active',
        startsOn: { lt: windowEnd },
        endsOn: { gte: windowStart },
      },
      orderBy: { createdAt: 'desc' },
    });
    const plan = program ? (JSON.parse(program.plan) as ProgramPlanDto) : null;

    const response: WeekResponse = {
      from,
      days: Array.from({ length: 7 }, (_, i) => {
        const date = shiftDate(from, i);
        const season = seasons.find((s) => isoDate(s.startsOn) <= date && date <= isoDate(s.endsOn));
        const dayEvents = events.filter((e) => isoDate(e.startsAt) === date);
        const dayType = classifyDay(
          date,
          season ? { startsOn: isoDate(season.startsOn), endsOn: isoDate(season.endsOn) } : null,
          dayEvents.map((e) => ({ type: e.type as EventType })),
        );
        const slice = plan ? todaySlice(plan, date) : null;
        return {
          date,
          dayType,
          event: dayEvents[0]
            ? { type: dayEvents[0].type as EventType, startsAt: dayEvents[0].startsAt.toISOString() }
            : null,
          programSession: dayType === 'OFF_SEASON' && slice?.session != null,
        };
      }),
    };
    return reply.send(response);
  });
}
