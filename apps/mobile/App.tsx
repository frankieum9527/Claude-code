import { useCallback } from 'react';
import { ClerkProvider, SignedIn, SignedOut, useAuth } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import { CLERK_PUBLISHABLE_KEY, DEV_USER_ID } from './src/config';
import { TodayScreen } from './src/screens/TodayScreen';
import { SignInScreen } from './src/screens/SignInScreen';

const tokenCache = {
  getToken: (key: string) => SecureStore.getItemAsync(key),
  saveToken: (key: string, value: string) => SecureStore.setItemAsync(key, value),
};

function ClerkToday() {
  const { getToken, signOut } = useAuth();
  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  }, [getToken]);
  return <TodayScreen getAuthHeaders={getAuthHeaders} onSignOut={() => signOut()} />;
}

export default function App() {
  if (!CLERK_PUBLISHABLE_KEY) {
    // Dev-stub mode: pair with an API that has no CLERK_ISSUER configured.
    const getAuthHeaders = async () => ({ 'x-user-id': DEV_USER_ID });
    return <TodayScreen getAuthHeaders={getAuthHeaders} />;
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <SignedIn>
        <ClerkToday />
      </SignedIn>
      <SignedOut>
        <SignInScreen />
      </SignedOut>
    </ClerkProvider>
  );
}
