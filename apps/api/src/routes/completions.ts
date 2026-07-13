import type { FastifyInstance } from 'fastify';
import type {
  AdherenceResponse,
  CompletionsResponse,
  ProgramPlanDto,
} from '@athlete-guide/shared-types';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireActor, requireUser } from '../auth.js';
import { computeStreak, shiftDate } from '../domain/streak.js';
import { todaySlice } from '../programs/skeleton.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const atMidnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** The player's active program covering `date`, if any. */
async function activeProgramFor(playerId: string, date: string) {
  return prisma.program.findFirst({
    where: {
      playerId,
      status: 'active',
      startsOn: { lte: atMidnight(date) },
      endsOn: { gte: atMidnight(date) },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * The day's check-offs (drills in season, program items off-season) plus the
 * streak. The streak counts a day active if EITHER kind of work happened —
 * it survives the season boundary.
 */
async function dayState(playerId: string, date: string): Promise<CompletionsResponse> {
  const windowStart = atMidnight(shiftDate(date, -60));
  const program = await activeProgramFor(playerId, date);
  const [todaysDrills, recentDrills, todaysItems, recentItems] = await Promise.all([
    prisma.drillCompletion.findMany({
      where: { playerId, date: atMidnight(date) },
      select: { drillId: true },
    }),
    prisma.drillCompletion.findMany({
      where: { playerId, date: { gte: windowStart, lte: atMidnight(date) } },
      select: { date: true },
      distinct: ['date'],
    }),
    program
      ? prisma.programItemCompletion.findMany({
          where: { playerId, programId: program.id, date: atMidnight(date) },
          select: { itemIndex: true },
        })
      : Promise.resolve([]),
    prisma.programItemCompletion.findMany({
      where: { playerId, date: { gte: windowStart, lte: atMidnight(date) } },
      select: { date: true },
      distinct: ['date'],
    }),
  ]);
  const activeDates = new Set([...recentDrills, ...recentItems].map((c) => isoDate(c.date)));
  return {
    date,
    drillIds: todaysDrills.map((c) => c.drillId),
    programItems: todaysItems.map((c) => c.itemIndex).sort((a, b) => a - b),
    streak: computeStreak(activeDates, date),
  };
}

export async function completionRoutes(app: FastifyInstance) {
  // The day's check-offs + current streak (hydrates the Today view).
  app.get('/me/completions', async (req, reply) => {
    const user = await requireActor(req, reply);
    if (!user) return;
    const { date } = req.query as { date?: string };
    if (!date || !DATE_RE.test(date)) {
      return reply.code(400).send({ error: 'date=YYYY-MM-DD is required' });
    }
    return reply.send(await dayState(user.id, date));
  });

  // Toggle one check-off for one day — a drill (in-season routines) or a
  // program item by index (off-season sessions). Exactly one of drillId /
  // programItem per call; responds with the authoritative day state.
  app.put('/me/completions', async (req, reply) => {
    const user = await requireActor(req, reply);
    if (!user) return;
    const parsed = z
      .object({
        date: z.string().regex(DATE_RE),
        drillId: z.string().min(1).optional(),
        programItem: z.number().int().min(0).optional(),
        done: z.boolean(),
      })
      .refine((b) => (b.drillId === undefined) !== (b.programItem === undefined), {
        message: 'Provide exactly one of drillId or programItem',
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { date, drillId, programItem, done } = parsed.data;

    if (drillId !== undefined) {
      if (done) {
        const drill = await prisma.drill.findUnique({ where: { id: drillId } });
        if (!drill) return reply.code(404).send({ error: 'Drill not found' });
        await prisma.drillCompletion.upsert({
          where: {
            playerId_drillId_date: { playerId: user.id, drillId, date: atMidnight(date) },
          },
          update: {},
          create: { playerId: user.id, drillId, date: atMidnight(date) },
        });
      } else {
        await prisma.drillCompletion.deleteMany({
          where: { playerId: user.id, drillId, date: atMidnight(date) },
        });
      }
    } else {
      const program = await activeProgramFor(user.id, date);
      if (!program) return reply.code(404).send({ error: 'No active program covers that date' });
      if (done) {
        // The index must address a real item in that date's session.
        const slice = todaySlice(JSON.parse(program.plan) as ProgramPlanDto, date);
        if (!slice?.session || programItem! >= slice.session.items.length) {
          return reply.code(409).send({ error: 'No such program item on that date' });
        }
        await prisma.programItemCompletion.upsert({
          where: {
            playerId_programId_date_itemIndex: {
              playerId: user.id,
              programId: program.id,
              date: atMidnight(date),
              itemIndex: programItem!,
            },
          },
          update: {},
          create: {
            playerId: user.id,
            programId: program.id,
            date: atMidnight(date),
            itemIndex: programItem!,
          },
        });
      } else {
        await prisma.programItemCompletion.deleteMany({
          where: {
            playerId: user.id,
            programId: program.id,
            date: atMidnight(date),
            itemIndex: programItem,
          },
        });
      }
    }
    return reply.send(await dayState(user.id, date));
  });

  // Coach: who's putting the work in? Window defaults to the last 7 days.
  app.get('/teams/:teamId/adherence', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { teamId } = req.params as { teamId: string };
    const daysRaw = Number((req.query as { days?: string }).days ?? 7);
    const days = Math.min(30, Math.max(1, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 7));

    const membership = await prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId: user.id, teamId } },
    });
    if (membership?.role !== 'coach') {
      return reply.code(403).send({ error: 'Only a team coach can view adherence' });
    }

    const players = await prisma.teamMembership.findMany({
      where: { teamId, role: 'player' },
      include: { user: { select: { id: true, name: true } } },
    });
    const today = isoDate(new Date());
    const windowStart = atMidnight(shiftDate(today, -(days - 1)));
    const playerIds = players.map((p) => p.user.id);
    // Both kinds of work count: drills in season, program items off-season.
    const [drillCompletions, itemCompletions] = await Promise.all([
      prisma.drillCompletion.findMany({
        where: { playerId: { in: playerIds }, date: { gte: windowStart } },
        select: { playerId: true, date: true },
      }),
      prisma.programItemCompletion.findMany({
        where: { playerId: { in: playerIds }, date: { gte: windowStart } },
        select: { playerId: true, date: true },
      }),
    ]);
    const completions = [...drillCompletions, ...itemCompletions];

    const byPlayer = new Map<string, { dates: Set<string>; total: number; last: string | null }>();
    for (const c of completions) {
      const entry = byPlayer.get(c.playerId) ?? { dates: new Set<string>(), total: 0, last: null };
      const d = isoDate(c.date);
      entry.dates.add(d);
      entry.total++;
      if (!entry.last || d > entry.last) entry.last = d;
      byPlayer.set(c.playerId, entry);
    }

    const response: AdherenceResponse = {
      days,
      players: players
        .map((p) => {
          const entry = byPlayer.get(p.user.id);
          return {
            userId: p.user.id,
            name: p.user.name,
            activeDays: entry?.dates.size ?? 0,
            completions: entry?.total ?? 0,
            lastActiveOn: entry?.last ?? null,
          };
        })
        .sort((a, b) => b.activeDays - a.activeDays || a.name.localeCompare(b.name)),
    };
    return reply.send(response);
  });
}
