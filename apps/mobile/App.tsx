import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { onAuthStateChanged, signOut, type Auth, type User } from 'firebase/auth';
import { DEV_USER_ID, FIREBASE_ENABLED } from './src/config';
import { getFirebaseAuth } from './src/firebase';
import { TodayScreen } from './src/screens/TodayScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { shared } from './src/theme';

function SignedInToday({ auth, user }: { auth: Auth; user: User }) {
  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    // getIdToken() returns the cached token and refreshes it when expired.
    const token = await user.getIdToken();
    return { authorization: `Bearer ${token}` };
  }, [user]);
  return <TodayScreen getAuthHeaders={getAuthHeaders} onSignOut={() => signOut(auth)} />;
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
  return <SignedInToday auth={auth} user={user} />;
}

export default function App() {
  if (!FIREBASE_ENABLED) {
    // Dev-stub mode: pair with an API that has no AUTH_ISSUER configured.
    const getAuthHeaders = async () => ({ 'x-user-id': DEV_USER_ID });
    return <TodayScreen getAuthHeaders={getAuthHeaders} />;
  }
  return <FirebaseApp />;
}
