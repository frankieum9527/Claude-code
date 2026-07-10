import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { onAuthStateChanged, signOut, type Auth, type User } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL, DEV_USER_ID, FIREBASE_ENABLED } from './src/config';
import { getFirebaseAuth } from './src/firebase';
import { Shell } from './src/Shell';
import { SignInScreen } from './src/screens/SignInScreen';
import { shared } from './src/theme';

function SignedInShell({ auth, user }: { auth: Auth; user: User }) {
  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    // getIdToken() returns the cached token and refreshes it when expired.
    const token = await user.getIdToken();
    return { authorization: `Bearer ${token}` };
  }, [user]);
  return <Shell getAuthHeaders={getAuthHeaders} onSignOut={() => signOut(auth)} />;
}

function FirebaseApp() {
  const auth = getFirebaseAuth();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setReady(true);
      }),
    [auth],
  );

  if (!ready) {
    return (
      <View style={[shared.root, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!user) return <SignInScreen auth={auth} />;
  return <SignedInShell auth={auth} user={user} />;
}

/**
 * Dev-stub mode (API without AUTH_ISSUER). Uses EXPO_PUBLIC_DEV_USER_ID when
 * set; otherwise self-provisions a demo user via /auth/dev-signup on first
 * launch and remembers it, so a fresh Codespace needs zero configuration.
 */
function DevApp() {
  const [userId, setUserId] = useState<string | null>(DEV_USER_ID || null);

  useEffect(() => {
    if (userId) return;
    (async () => {
      const stored = await AsyncStorage.getItem('devUserId');
      if (stored) {
        setUserId(stored);
        return;
      }
      try {
        const res = await fetch(`${API_URL}/auth/dev-signup`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Demo User',
            email: `demo-${Date.now().toString(36)}@example.com`,
            role: 'coach',
          }),
        });
        if (res.ok) {
          const user = (await res.json()) as { id: string };
          await AsyncStorage.setItem('devUserId', user.id);
          setUserId(user.id);
        }
      } catch {
        // Shell/Today surface API connectivity problems with the URL tried.
        setUserId('');
      }
    })();
  }, [userId]);

  if (userId === null) {
    return (
      <View style={[shared.root, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  const getAuthHeaders = async () => ({ 'x-user-id': userId });
  return <Shell getAuthHeaders={getAuthHeaders} />;
}

export default function App() {
  if (!FIREBASE_ENABLED) {
    return <DevApp />;
  }
  return <FirebaseApp />;
}
