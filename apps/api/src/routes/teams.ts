import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  EventType,
  MembershipRole,
  ScheduleResponse,
  Sport,
  TeamDetailResponse,
} from '@athlete-guide/shared-types';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../auth.js';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;

const createTeamBody = z.object({
  name: z.string().min(1),
  sport: z.enum(['hockey']),
});

const joinBody = z.object({
  joinCode: z.string().min(1),
});

const createSeasonBody = z.object({
  name: z.string().min(1),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const createEventBody = z.object({
  type: z.enum(['practice', 'game']),
  startsAt: z.string().datetime(),
  location: z.string().optional(),
});

function newJoinCode() {
  return randomBytes(4).toString('hex').toUpperCase();
}

export async function teamRoutes(app: FastifyInstance) {
  app.post('/teams', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = createTeamBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const team = await prisma.team.create({
      data: {
        ...parsed.data,
        joinCode: newJoinCode(),
        memberships: { create: { userId: user.id, role: 'coach' } },
      },
    });
    return reply.code(201).send(team);
  });

  app.post('/teams/join', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = joinBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const team = await prisma.team.findUnique({ where: { joinCode: parsed.data.joinCode } });
    if (!team) return reply.code(404).send({ error: 'No team with that join code' });

    await prisma.teamMembership.upsert({
      where: { userId_teamId: { userId: user.id, teamId: team.id } },
      update: {},
      create: { userId: user.id, teamId: team.id, role: 'player' },
    });
    return reply.send(team);
  });

  app.get('/teams/:teamId', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { teamId } = req.params as { teamId: string };

    const membership = await prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId: user.id, teamId } },
    });
    if (!membership) return reply.code(403).send({ error: 'Not a member of this team' });

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        memberships: { include: { user: { select: { id: true, name: true } } } },
        seasons: { orderBy: { startsOn: 'desc' } },
      },
    });
    if (!team) return reply.code(404).send({ error: 'Team not found' });

    const response: TeamDetailResponse = {
      team: { id: team.id, name: team.name, sport: team.sport as Sport, joinCode: team.joinCode },
      members: team.memberships.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        membershipRole: m.role as MembershipRole,
      })),
      seasons: team.seasons.map((s) => ({
        id: s.id,
        teamId: s.teamId,
        name: s.name,
        startsOn: isoDate(s.startsOn),
        endsOn: isoDate(s.endsOn),
      })),
      feed: {
        icsUrl: team.icsUrl,
        icsGamesUrl: team.icsGamesUrl,
        status: team.icsSyncStatus,
        error: team.icsSyncError,
        lastSyncedAt: team.icsLastSyncedAt?.toISOString() ?? null,
      },
    };
    return reply.send(response);
  });

  // Upcoming (or windowed) schedule across all of the team's seasons.
  app.get('/teams/:teamId/schedule', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { teamId } = req.params as { teamId: string };
    const query = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() });

    const membership = await prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId: user.id, teamId } },
    });
    if (!membership) return reply.code(403).send({ error: 'Not a member of this team' });

    const from = query.data.from ?? isoDate(new Date());
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = query.data.to
      ? new Date(new Date(`${query.data.to}T00:00:00.000Z`).getTime() + DAY_MS) // inclusive
      : new Date(fromDate.getTime() + 30 * DAY_MS);

    const events = await prisma.scheduleEvent.findMany({
      where: {
        season: { teamId },
        startsAt: { gte: fromDate, lt: toDate },
      },
      orderBy: { startsAt: 'asc' },
    });

    const response: ScheduleResponse = {
      from,
      to: isoDate(new Date(toDate.getTime() - DAY_MS)),
      events: events.map((e) => ({
        id: e.id,
        seasonId: e.seasonId,
        type: e.type as EventType,
        title: e.title,
        startsAt: e.startsAt.toISOString(),
        location: e.location,
        source: e.source as 'manual' | 'ics',
      })),
    };
    return reply.send(response);
  });

  app.post('/teams/:teamId/seasons', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { teamId } = req.params as { teamId: string };
    const parsed = createSeasonBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { name, startsOn, endsOn } = parsed.data;
    if (endsOn < startsOn) {
      return reply.code(400).send({ error: 'endsOn must not be before startsOn' });
    }

    const membership = await prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId: user.id, teamId } },
    });
    if (membership?.role !== 'coach') {
      return reply.code(403).send({ error: 'Only a team coach can manage seasons' });
    }

    const season = await prisma.season.create({
      data: {
        teamId,
        name,
        startsOn: new Date(`${startsOn}T00:00:00.000Z`),
        endsOn: new Date(`${endsOn}T00:00:00.000Z`),
      },
    });
    return reply.code(201).send(season);
  });

  app.post('/seasons/:seasonId/events', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { seasonId } = req.params as { seasonId: string };
    const parsed = createEventBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const season = await prisma.season.findUnique({ where: { id: seasonId } });
    if (!season) return reply.code(404).send({ error: 'Season not found' });

    const membership = await prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId: user.id, teamId: season.teamId } },
    });
    if (membership?.role !== 'coach') {
      return reply.code(403).send({ error: 'Only a team coach can manage the schedule' });
    }

    const event = await prisma.scheduleEvent.create({
      data: {
        seasonId,
        type: parsed.data.type,
        startsAt: new Date(parsed.data.startsAt),
        location: parsed.data.location,
      },
    });
    return reply.code(201).send(event);
  });

  // Coach correction for imported events whose game/practice heuristic was
  // wrong. Corrections survive re-syncs (the importer never updates `type`).
  app.patch('/events/:eventId', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { eventId } = req.params as { eventId: string };
    const parsed = z.object({ type: z.enum(['practice', 'game']) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const event = await prisma.scheduleEvent.findUnique({
      where: { id: eventId },
      include: { season: true },
    });
    if (!event) return reply.code(404).send({ error: 'Event not found' });

    const membership = await prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId: user.id, teamId: event.season.teamId } },
    });
    if (membership?.role !== 'coach') {
      return reply.code(403).send({ error: 'Only a team coach can edit events' });
    }

    const updated = await prisma.scheduleEvent.update({
      where: { id: eventId },
      data: { type: parsed.data.type },
    });
    return reply.send(updated);
  });
}
