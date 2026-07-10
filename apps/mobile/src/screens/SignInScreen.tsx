import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';
import { colors, shared } from '../theme';
import { Logo } from '../ui';

function friendlyError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password is incorrect.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists — try signing in.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/too-many-requests':
      return 'Too many attempts — try again in a few minutes.';
    default:
      return e instanceof Error ? e.message : 'Something went wrong.';
  }
}

/**
 * Firebase email/password sign-in with an explicit create-account mode and
 * password reset. Google/Apple sign-in buttons can be added alongside later
 * (App Store requires Apple once any social login ships).
 */
export function SignInScreen({ auth }: { auth: Auth }) {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signIn') {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      }
      // onAuthStateChanged in App.tsx takes over from here.
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    setError(null);
    setNotice(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice(`Password reset email sent to ${email.trim()}.`);
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  return (
    <View style={[shared.root, shared.scroll]}>
      <Logo />
      <View style={shared.card}>
        <Text style={shared.cardTitle}>
          {mode === 'signIn' ? 'Sign in' : 'Create account'}
        </Text>
        <TextInput
          style={shared.input}
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
        />
        <TextInput
          style={shared.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
        />
        {error && <Text style={shared.errorText}>{error}</Text>}
        {notice && <Text style={shared.muted}>{notice}</Text>}
        <Pressable style={shared.button} onPress={submit} disabled={busy || !email || !password}>
          <Text style={shared.buttonText}>
            {busy ? 'Working…' : mode === 'signIn' ? 'Sign in' : 'Create account'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setMode(mode === 'signIn' ? 'signUp' : 'signIn');
            setError(null);
            setNotice(null);
          }}
        >
          <Text style={[shared.muted, { marginTop: 14 }]}>
            {mode === 'signIn' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </Text>
        </Pressable>
        {mode === 'signIn' && (
          <Pressable onPress={resetPassword} disabled={!email}>
            <Text style={[shared.muted, { marginTop: 8 }]}>Forgot password?</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
