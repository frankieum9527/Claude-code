import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { prisma } from './db.js';

/**
 * Two modes:
 *
 * - Clerk mode (CLERK_ISSUER set): requests carry `Authorization: Bearer <jwt>`
 *   (a Clerk session token). We verify signature + issuer + expiry against
 *   Clerk's JWKS — no Clerk SDK needed, just standard OIDC pieces via jose,
 *   so any compliant provider could replace Clerk later.
 * - Dev mode (no CLERK_ISSUER): the `x-user-id` header stands in for identity.
 *   Used by tests, the seed flow, and local hacking.
 *
 * `email`/`name` claims are optional; add them to Clerk's session token via a
 * dashboard JWT template ({{user.primary_email_address}}, {{user.full_name}})
 * for nicer auto-filled profiles.
 */

export interface Identity {
  clerkUserId: string;
  email?: string;
  name?: string;
}

type Verifier = (token: string) => Promise<Identity>;

let verifier: Verifier | null = null;

export function initClerkAuth(issuer: string, getKey?: JWTVerifyGetKey): void {
  const key = getKey ?? createRemoteJWKSet(new URL('/.well-known/jwks.json', issuer));
  verifier = async (token) => {
    const { payload } = await jwtVerify(token, key, { issuer });
    if (!payload.sub) throw new Error('token has no sub claim');
    return {
      clerkUserId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  };
}

if (process.env.CLERK_ISSUER) {
  initClerkAuth(process.env.CLERK_ISSUER);
}

export const isClerkMode = (): boolean => verifier !== null;

/** Exposed for unit tests. */
export async function verifyBearer(token: string): Promise<Identity> {
  if (!verifier) throw new Error('Clerk auth is not configured');
  return verifier(token);
}

/**
 * Verified identity from the request, or null after sending 401.
 * In Clerk mode an identity can exist without an app profile yet —
 * `POST /auth/register` turns one into the other.
 */
export async function requireIdentity(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<Identity | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing Authorization: Bearer token' });
    return null;
  }
  try {
    return await verifyBearer(header.slice('Bearer '.length));
  } catch {
    reply.code(401).send({ error: 'Invalid or expired token' });
    return null;
  }
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  if (!isClerkMode()) {
    // Dev-mode stub identity.
    const id = req.headers['x-user-id'];
    if (typeof id !== 'string' || id.length === 0) {
      reply.code(401).send({ error: 'Missing x-user-id header (dev auth mode)' });
      return null;
    }
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      reply.code(401).send({ error: 'Unknown user' });
      return null;
    }
    return user;
  }

  const identity = await requireIdentity(req, reply);
  if (!identity) return null;
  const user = await prisma.user.findUnique({ where: { clerkUserId: identity.clerkUserId } });
  if (!user) {
    reply.code(403).send({
      error: 'no_profile',
      hint: 'Authenticated but no profile yet — POST /auth/register first',
    });
    return null;
  }
  return user;
}
