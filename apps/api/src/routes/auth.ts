import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { isOidcMode, requireIdentity } from '../auth.js';

const devSignupBody = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['player', 'coach', 'parent']),
});

// Self-signup is for adults (coach/parent) and self-managed teens; under-13
// players are created as guardian-managed profiles (Phase 2 consent flow).
const registerBody = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(['player', 'coach', 'parent']),
});

export async function authRoutes(app: FastifyInstance) {
  // Dev stand-in for the identity provider. Disabled in OIDC mode.
  app.post('/auth/dev-signup', async (req, reply) => {
    if (isOidcMode()) {
      return reply.code(404).send({ error: 'Not available when OIDC auth is enabled' });
    }
    const parsed = devSignupBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { name, email, role } = parsed.data;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { name, email, role },
    });
    return reply.code(201).send({ id: user.id, name: user.name, email: user.email, role: user.role });
  });

  // Create the app profile for a verified identity (first sign-in).
  // name/email come from token claims when present (Firebase includes both);
  // the body can supply or override either.
  app.post('/auth/register', async (req, reply) => {
    if (!isOidcMode()) {
      return reply.code(404).send({ error: 'Use /auth/dev-signup in dev auth mode' });
    }
    const identity = await requireIdentity(req, reply);
    if (!identity) return;
    const parsed = registerBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const existing = await prisma.user.findUnique({
      where: { authProviderId: identity.authProviderId },
    });
    if (existing) return reply.send(existing);

    const email = parsed.data.email ?? identity.email;
    const name = parsed.data.name ?? identity.name;
    if (!email || !name) {
      return reply.code(400).send({
        error: 'name and email are required (not present in token claims)',
      });
    }

    const user = await prisma.user.create({
      data: { authProviderId: identity.authProviderId, email, name, role: parsed.data.role },
    });
    return reply.code(201).send(user);
  });
}
