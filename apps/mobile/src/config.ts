/**
 * Dev configuration. Set these when starting Expo, e.g.:
 *   EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 EXPO_PUBLIC_DEV_USER_ID=<id> npm run mobile
 *
 * DEV_USER_ID is the dev-auth stand-in (x-user-id header) until managed auth
 * lands — get an id from the API seed output or POST /auth/dev-signup.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
export const DEV_USER_ID = process.env.EXPO_PUBLIC_DEV_USER_ID ?? '';
