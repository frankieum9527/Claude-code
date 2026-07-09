import { getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebaseConfig } from './config';

let auth: Auth | null = null;

/** Lazy singleton — only touched when FIREBASE_ENABLED is true. */
export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  if (getApps().length === 0) {
    const app = initializeApp(firebaseConfig);
    // React Native has no browser storage; persist sessions in AsyncStorage.
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } else {
    auth = getAuth();
  }
  return auth;
}
