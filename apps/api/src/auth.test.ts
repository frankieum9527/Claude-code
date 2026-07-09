import { beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { initClerkAuth, verifyBearer } from './auth.js';

const ISSUER = 'https://test-issuer.example.com';

let privateKey: CryptoKey;

async function makeToken(overrides: {
  issuer?: string;
  expiresAt?: number;
  sub?: string | null;
  claims?: Record<string, unknown>;
}) {
  const jwt = new SignJWT({ ...overrides.claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setIssuedAt()
    .setExpirationTime(overrides.expiresAt ?? Math.floor(Date.now() / 1000) + 3600);
  if (overrides.sub !== null) jwt.setSubject(overrides.sub ?? 'user_abc123');
  return jwt.sign(privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey as CryptoKey;
  const jwk = await exportJWK(pair.publicKey);
  initClerkAuth(ISSUER, createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256' }] }));
});

describe('verifyBearer', () => {
  it('accepts a valid token and extracts identity claims', async () => {
    const token = await makeToken({
      claims: { email: 'coach@example.com', name: 'Casey Coach' },
    });
    await expect(verifyBearer(token)).resolves.toEqual({
      clerkUserId: 'user_abc123',
      email: 'coach@example.com',
      name: 'Casey Coach',
    });
  });

  it('tolerates missing optional claims', async () => {
    const token = await makeToken({});
    await expect(verifyBearer(token)).resolves.toEqual({
      clerkUserId: 'user_abc123',
      email: undefined,
      name: undefined,
    });
  });

  it('rejects a token from the wrong issuer', async () => {
    const token = await makeToken({ issuer: 'https://evil.example.com' });
    await expect(verifyBearer(token)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await makeToken({ expiresAt: Math.floor(Date.now() / 1000) - 60 });
    await expect(verifyBearer(token)).rejects.toThrow();
  });

  it('rejects a token without a sub claim', async () => {
    const token = await makeToken({ sub: null });
    await expect(verifyBearer(token)).rejects.toThrow(/sub/);
  });

  it('rejects garbage', async () => {
    await expect(verifyBearer('not-a-jwt')).rejects.toThrow();
  });
});
