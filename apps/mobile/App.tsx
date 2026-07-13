import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Sora_700Bold, Sora_800ExtraBold, useFonts } from '@expo-google-fonts/sora';
import { onAuthStateChanged, signOut, type Auth, type User } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DevPersonaDto, DevPersonasResponse } from '@athlete-guide/shared-types';
import { API_URL, DEV_USER_ID, FIREBASE_ENABLED } from './src/config';
import { getFirebaseAuth } from './src/firebase';
import { Shell } from './src/Shell';
import { DevBar } from './src/DevBar';
import { SignInScreen } from './src/screens/SignInScreen';
import { localToday, shiftDate } from './src/dates';
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
  const [personas, setPersonas] = useState<DevPersonaDto[]>([]);
  const [date, setDate] = useState(localToday());

  const createDemoUser = useCallback(async (): Promise<string | null> => {
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
      if (!res.ok) return null;
      const user = (await res.json()) as { id: string };
      await AsyncStorage.setItem('devUserId', user.id);
      return user.id;
    } catch {
      return null;
    }
  }, []);

  const loadPersonas = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/auth/dev-personas`);
      if (res.ok) setPersonas(((await res.json()) as DevPersonasResponse).personas);
    } catch {
      // demo bar just shows no personas; the app still works
    }
  }, []);

  useEffect(() => {
    loadPersonas();
    if (userId) return;
    (async () => {
      const stored = await AsyncStorage.getItem('devUserId');
      setUserId(stored ?? (await createDemoUser()) ?? '');
    })();
  }, [userId, createDemoUser, loadPersonas]);

  if (userId === null) {
    return (
      <View style={[shared.root, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const switchTo = async (id: string) => {
    await AsyncStorage.setItem('devUserId', id);
    setUserId(id);
  };
  const getAuthHeaders = async () => ({ 'x-user-id': userId });

  return (
    <View style={{ flex: 1 }}>
      {/* key remounts the Shell so tabs/data reload for the new persona */}
      <Shell key={userId} getAuthHeaders={getAuthHeaders} devDate={date} />
      <DevBar
        personas={personas}
        currentId={userId}
        onSwitch={switchTo}
        onNewUser={async () => {
          const id = await createDemoUser();
          if (id) {
            setUserId(id);
            await loadPersonas();
          }
        }}
        date={date}
        isToday={date === localToday()}
        onShiftDate={(days) => setDate(shiftDate(date, days))}
        onResetDate={() => setDate(localToday())}
      />
    </View>
  );
}

export default function App() {
  // Brand wordmark/heading face (docs/BRAND.md); body text stays system.
  const [fontsLoaded] = useFonts({ Sora_700Bold, Sora_800ExtraBold });
  if (!fontsLoaded) {
    return (
      <View style={[shared.root, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!FIREBASE_ENABLED) {
    return <DevApp />;
  }
  return <FirebaseApp />;
}
