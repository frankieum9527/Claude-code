import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { prisma } from './db.js';

/**
 * Two modes:
 *
 * - OIDC mode (AUTH_ISSUER set): requests carry `Authorization: Bearer <jwt>`
 *   — an ID/session token from the identity provider. We discover the
 *   issuer's JWKS via its /.well-known/openid-configuration and verify
 *   signature, issuer, expiry, and (when AUTH_AUDIENCE is set) audience.
 *   Works with Firebase Auth (issuer https://securetoken.google.com/<project>,
 *   audience <project>), and any other compliant provider — no vendor SDK.
 * - Dev mode (no AUTH_ISSUER): the `x-user-id` header stands in for identity.
 *   Used by tests, the seed flow, and local hacking.
 *
 * Firebase ID tokens carry `email` and `name` (when the account has a display
 * name) claims, which pre-fill profile registration.
 */

export interface Identity {
  authProviderId: string;
  email?: string;
  name?: string;
}

type Verifier = (token: string) => Promise<Identity>;

let verifier: Verifier | null = null;

export interface OidcOptions {
  issuer: string;
  audience?: string;
  /** Test seam: bypasses discovery with a local key set. */
  getKey?: JWTVerifyGetKey;
}

export function initOidcAuth({ issuer, audience, getKey }: OidcOptions): void {
  // Discovery is lazy (first verification) and cached, so booting the API
  // doesn't depend on the issuer being reachable.
  let keySource: JWTVerifyGetKey | null = getKey ?? null;
  const resolveKey: JWTVerifyGetKey = async (header, token) => {
    if (!keySource) {
      const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
      const res = await fetch(discoveryUrl, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
      const { jwks_uri } = (await res.json()) as { jwks_uri?: string };
      if (!jwks_uri) throw new Error('OIDC discovery document has no jwks_uri');
      keySource = createRemoteJWKSet(new URL(jwks_uri));
    }
    return keySource(header, token);
  };

  verifier = async (token) => {
    const { payload } = await jwtVerify(token, resolveKey, {
      issuer,
      ...(audience ? { audience } : {}),
    });
    if (!payload.sub) throw new Error('token has no sub claim');
    return {
      authProviderId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  };
}

if (process.env.AUTH_ISSUER) {
  initOidcAuth({ issuer: process.env.AUTH_ISSUER, audience: process.env.AUTH_AUDIENCE });
}

export const isOidcMode = (): boolean => verifier !== null;

/** Exposed for unit tests. */
export async function verifyBearer(token: string): Promise<Identity> {
  if (!verifier) throw new Error('OIDC auth is not configured');
  return verifier(token);
}

/**
 * Verified identity from the request, or null after sending 401.
 * In OIDC mode an identity can exist without an app profile yet —
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
  if (!isOidcMode()) {
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
  const user = await prisma.user.findUnique({
    where: { authProviderId: identity.authProviderId },
  });
  if (!user) {
    reply.code(403).send({
      error: 'no_profile',
      hint: 'Authenticated but no profile yet — POST /auth/register first',
    });
    return null;
  }
  return user;
}
