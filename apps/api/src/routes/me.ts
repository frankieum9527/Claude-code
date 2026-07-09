import type { FastifyInstance } from 'fastify';
import type {
  RoutineDto,
  Sport,
  TodayResponse,
  EventType,
  RoutineKind,
} from '@athlete-guide/shared-types';
import { ROUTINE_KIND_FOR_DAY } from '@athlete-guide/shared-types';
import { prisma } from '../db.js';
import { requireUser } from '../auth.js';
import { classifyDay } from '../domain/classifyDay.js';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export async function meRoutes(app: FastifyInstance) {
  /**
   * The player's Today view: classify the day and return the matching
   * schedule + routine. `?date=YYYY-MM-DD` overrides "today" (useful for
   * demos and tests).
   *
   * Day boundaries are UTC for now; per-team timezones are a Phase 1 item
   * (see docs/PLAN.md).
   */
  app.get('/me/today', async (req, reply) => {
    const user = await requireUser(req, reply);
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

    const empty: TodayResponse = {
      date,
      dayType: 'OFF_SEASON',
      team: null,
      season: null,
      events: [],
      routine: null,
    };
    if (!membership) return reply.send(empty);
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
    };
    return reply.send(response);
  });
}
