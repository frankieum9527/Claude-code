/**
 * Dev configuration. Set these when starting Expo, e.g.:
 *   EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 EXPO_PUBLIC_DEV_USER_ID=<id> npm run mobile
 *
 * DEV_USER_ID is the dev-auth stand-in (x-user-id header) until managed auth
 * lands — get an id from the API seed output or POST /auth/dev-signup.
 */
function defaultApiUrl(): string {
  // GitHub Codespaces exposes ports as <codespace>-<port>.app.github.dev.
  // When the web build is served from the 8081 URL, derive the API's 3000
  // URL from our own hostname so no env var is needed (port 3000 must be
  // set to Public in the Ports panel).
  if (typeof window !== 'undefined') {
    const host = window.location?.hostname ?? '';
    if (host.endsWith('.app.github.dev')) {
      return `https://${host.replace(/-\d+(?=\.app\.github\.dev$)/, '-3000')}`;
    }
  }
  return 'http://localhost:3000';
}

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? defaultApiUrl();
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
