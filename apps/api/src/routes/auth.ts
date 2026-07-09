import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const signupBody = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['player', 'coach', 'parent']),
});

export async function authRoutes(app: FastifyInstance) {
  // Dev stand-in for the managed auth provider's signup. Returns the user id
  // to pass as `x-user-id` on subsequent requests.
  app.post('/auth/dev-signup', async (req, reply) => {
    const parsed = signupBody.safeParse(req.body);
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
}
