/**
 * Dev configuration. Set these when starting Expo, e.g.:
 *   EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 EXPO_PUBLIC_DEV_USER_ID=<id> npm run mobile
 *
 * DEV_USER_ID is the dev-auth stand-in (x-user-id header) until managed auth
 * lands — get an id from the API seed output or POST /auth/dev-signup.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
export const DEV_USER_ID = process.env.EXPO_PUBLIC_DEV_USER_ID ?? '';

/**
 * Clerk publishable key (Dashboard → API keys). When set, the app requires
 * sign-in and sends session JWTs to the API; when unset, it falls back to
 * dev-stub auth using DEV_USER_ID above (pair with an API that has no
 * CLERK_ISSUER configured).
 */
export const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
