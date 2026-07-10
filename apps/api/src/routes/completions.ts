import type { FastifyInstance } from 'fastify';
import type { AdherenceResponse, CompletionsResponse } from '@athlete-guide/shared-types';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../auth.js';
import { computeStreak, shiftDate } from '../domain/streak.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const atMidnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

async function dayState(playerId: string, date: string): Promise<CompletionsResponse> {
  const [todays, recent] = await Promise.all([
    prisma.drillCompletion.findMany({
      where: { playerId, date: atMidnight(date) },
      select: { drillId: true },
    }),
    prisma.drillCompletion.findMany({
      where: { playerId, date: { gte: atMidnight(shiftDate(date, -60)), lte: atMidnight(date) } },
      select: { date: true },
      distinct: ['date'],
    }),
  ]);
  return {
    date,
    drillIds: todays.map((c) => c.drillId),
    streak: computeStreak(new Set(recent.map((c) => isoDate(c.date))), date),
  };
}

export async function completionRoutes(app: FastifyInstance) {
  // The day's check-offs + current streak (hydrates the Today view).
  app.get('/me/completions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { date } = req.query as { date?: string };
    if (!date || !DATE_RE.test(date)) {
      return reply.code(400).send({ error: 'date=YYYY-MM-DD is required' });
    }
    return reply.send(await dayState(user.id, date));
  });

  // Toggle one drill for one day; responds with the authoritative day state.
  app.put('/me/completions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = z
      .object({
        date: z.string().regex(DATE_RE),
        drillId: z.string().min(1),
        done: z.boolean(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { date, drillId, done } = parsed.data;

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
    const completions = await prisma.drillCompletion.findMany({
      where: { playerId: { in: players.map((p) => p.user.id) }, date: { gte: windowStart } },
      select: { playerId: true, date: true },
    });

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
