import { getApps, initializeApp } from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import type { Auth, Persistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebaseConfig } from './config';

// getReactNativePersistence exists at runtime (via the package's
// "react-native" exports condition) but is missing from the published type
// declarations, so it's pulled out with a cast.
const getReactNativePersistence = (
  firebaseAuth as unknown as {
    getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
  }
).getReactNativePersistence;

let auth: Auth | null = null;

/** Lazy singleton — only touched when FIREBASE_ENABLED is true. */
export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  if (getApps().length === 0) {
    const app = initializeApp(firebaseConfig);
    // React Native has no browser storage; persist sessions in AsyncStorage.
    auth = firebaseAuth.initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } else {
    auth = firebaseAuth.getAuth();
  }
  return auth;
}
