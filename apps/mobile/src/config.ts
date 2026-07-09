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
 * Firebase web-app config (Console → Project settings → Your apps). When all
 * three are set, the app requires sign-in and sends Firebase ID tokens to the
 * API; when unset, it falls back to dev-stub auth using DEV_USER_ID above
 * (pair with an API that has no AUTH_ISSUER configured).
 */
export const FIREBASE_API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '';
export const FIREBASE_PROJECT_ID = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '';
export const FIREBASE_APP_ID = process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '';

export const FIREBASE_ENABLED = Boolean(
  FIREBASE_API_KEY && FIREBASE_PROJECT_ID && FIREBASE_APP_ID,
);

export const firebaseConfig = {
  apiKey: FIREBASE_API_KEY,
  authDomain: `${FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: FIREBASE_PROJECT_ID,
  appId: FIREBASE_APP_ID,
};
