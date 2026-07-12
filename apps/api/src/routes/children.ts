import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ChildDto, ChildrenResponse } from '@athlete-guide/shared-types';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireUser } from '../auth.js';
import { ageOn } from '../domain/age.js';

/**
 * Guardian-managed player profiles (ARCHITECTURE.md §8). Under-13s never
 * self-signup: a guardian creates the child's profile under their own
 * account, joins them to a team, and grants (or revokes) video-upload
 * consent. Children have no credentials — the guardian's device acts for
 * them via the x-child-id header (see requireActor in ../auth.ts).
 *
 * Every route here uses requireUser, not requireActor: guardianship actions
 * must come from the guardian's own identity.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const createChildBody = z.object({
  name: z.string().min(1).max(80),
  birthdate: z.string().regex(DATE_RE),
});

type ChildWithTeams = Prisma.UserGetPayload<{
  include: { memberships: { include: { team: { select: { id: true; name: true } } } } };
}>;

function toChildDto(child: ChildWithTeams): ChildDto {
  return {
    id: child.id,
    name: child.name,
    birthdate: isoDate(child.birthdate!),
    age: ageOn(child.birthdate!, new Date()),
    videoConsentAt: child.videoConsentAt?.toISOString() ?? null,
    teams: child.memberships.map((m) => ({ teamId: m.team.id, name: m.team.name })),
  };
}

const childInclude = {
  memberships: { include: { team: { select: { id: true, name: true } } } },
} as const;

export async function childrenRoutes(app: FastifyInstance) {
  // Create a guardian-managed player profile.
  app.post('/me/children', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.guardianId) {
      return reply.code(403).send({ error: 'Child profiles cannot manage children' });
    }
    const parsed = createChildBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const birthdate = new Date(`${parsed.data.birthdate}T00:00:00.000Z`);
    const age = ageOn(birthdate, new Date());
    if (age < 4 || age > 17) {
      return reply.code(400).send({
        error: 'Guardian-managed profiles are for players aged 4–17; adults sign up themselves.',
      });
    }

    const child = await prisma.user.create({
      data: {
        name: parsed.data.name.trim(),
        // Users require a unique email; children have no real inbox. The
        // reserved .invalid TLD guarantees nothing ever routes to it.
        email: `child-${randomUUID()}@guardian.invalid`,
        role: 'player',
        birthdate,
        guardianId: user.id,
      },
      include: childInclude,
    });
    return reply.code(201).send(toChildDto(child));
  });

  // My children, with teams and consent state.
  app.get('/me/children', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const children = await prisma.user.findMany({
      where: { guardianId: user.id },
      orderBy: { createdAt: 'asc' },
      include: childInclude,
    });
    const response: ChildrenResponse = { children: children.map(toChildDto) };
    return reply.send(response);
  });

  // Grant or revoke video-upload consent (the COPPA gate enforced in
  // POST /submissions). Only the child's own guardian can flip this.
  app.put('/me/children/:childId/consent', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { childId } = req.params as { childId: string };
    const parsed = z.object({ videoUploads: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const child = await prisma.user.findUnique({ where: { id: childId } });
    if (!child || child.guardianId !== user.id) {
      return reply.code(403).send({ error: 'Not a guardian of this player' });
    }
    const updated = await prisma.user.update({
      where: { id: childId },
      data: { videoConsentAt: parsed.data.videoUploads ? new Date() : null },
      include: childInclude,
    });
    return reply.send(toChildDto(updated));
  });
}
