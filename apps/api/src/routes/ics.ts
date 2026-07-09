import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../auth.js';
import { fetchIcs, importIcsToTeam, normalizeIcsUrl } from '../sync/ics.js';
import { runTrackedTeamSync } from '../sync/scheduler.js';

const connectBody = z.object({
  url: z.string().min(1),
  /** Optional games-only companion feed (TeamSnap offers one) for exact typing. */
  gamesUrl: z.string().min(1).optional(),
});

async function requireCoach(userId: string, teamId: string) {
  const membership = await prisma.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });
  return membership?.role === 'coach';
}

export async function icsRoutes(app: FastifyInstance) {
  // Connect (or replace) a team's calendar feed and run the initial import.
  app.put('/teams/:teamId/ics', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { teamId } = req.params as { teamId: string };
    if (!(await requireCoach(user.id, teamId))) {
      return reply.code(403).send({ error: 'Only a team coach can connect a calendar feed' });
    }
    const parsed = connectBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    let url: string;
    let gamesUrl: string | undefined;
    try {
      url = normalizeIcsUrl(parsed.data.url);
      gamesUrl = parsed.data.gamesUrl ? normalizeIcsUrl(parsed.data.gamesUrl) : undefined;
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }

    try {
      const [icsText, gamesText] = await Promise.all([
        fetchIcs(url),
        gamesUrl ? fetchIcs(gamesUrl) : Promise.resolve(undefined),
      ]);
      const result = await importIcsToTeam(teamId, icsText, gamesText);
      await prisma.team.update({
        where: { id: teamId },
        data: {
          icsUrl: url,
          icsGamesUrl: gamesUrl ?? null,
          icsLastSyncedAt: new Date(),
          icsSyncStatus: 'ok',
          icsSyncError: null,
        },
      });
      return reply.send({ url, gamesUrl: gamesUrl ?? null, ...result });
    } catch (e) {
      return reply
        .code(422)
        .send({ error: `Could not import feed: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  // "Sync now" — refetch the stored feed(s). A worker will do this on a
  // schedule in Phase 1; the endpoint stays for the coach-facing button.
  app.post('/teams/:teamId/ics/sync', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { teamId } = req.params as { teamId: string };
    if (!(await requireCoach(user.id, teamId))) {
      return reply.code(403).send({ error: 'Only a team coach can sync the calendar feed' });
    }
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) return reply.code(404).send({ error: 'Team not found' });
    if (!team.icsUrl) return reply.code(409).send({ error: 'No calendar feed configured' });

    const outcome = await runTrackedTeamSync(teamId);
    if (!outcome.ok) {
      return reply.code(422).send({ error: `Sync failed: ${outcome.error}` });
    }
    return reply.send(outcome.result);
  });
}
