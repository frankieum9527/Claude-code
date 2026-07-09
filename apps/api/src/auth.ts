import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './db.js';

/**
 * Dev-only identity: the client sends its user id in the `x-user-id` header.
 * Phase 0 replaces this with a managed auth provider (JWT verification here),
 * without changing any route code — routes only ever see the resolved user.
 */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const id = req.headers['x-user-id'];
  if (typeof id !== 'string' || id.length === 0) {
    reply.code(401).send({ error: 'Missing x-user-id header (dev auth stub)' });
    return null;
  }
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    reply.code(401).send({ error: 'Unknown user' });
    return null;
  }
  return user;
}
