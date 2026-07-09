import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSignIn, useSignUp } from '@clerk/clerk-expo';
import { shared } from '../theme';

/**
 * Email-code sign-in with automatic sign-up for new addresses. Kept to the
 * one passwordless strategy on purpose — coaches and parents get a code by
 * email, no passwords to manage. OAuth (Apple/Google) can be added alongside
 * later.
 */
export function SignInScreen() {
  const { signIn, setActive: activateSignIn, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: activateSignUp, isLoaded: signUpLoaded } = useSignUp();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'email' | 'code'>('email');
  const [flow, setFlow] = useState<'signIn' | 'signUp'>('signIn');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = signInLoaded && signUpLoaded;

  const sendCode = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = await signIn.create({ identifier: email });
      const factor = attempt.supportedFirstFactors?.find(
        (f) => f.strategy === 'email_code',
      );
      if (!factor || !('emailAddressId' in factor)) {
        throw new Error('Email code sign-in is not enabled for this account');
      }
      await signIn.prepareFirstFactor({
        strategy: 'email_code',
        emailAddressId: factor.emailAddressId,
      });
      setFlow('signIn');
      setPhase('code');
    } catch {
      // Unknown address → create the account instead.
      try {
        await signUp.create({ emailAddress: email });
        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
        setFlow('signUp');
        setPhase('code');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not start sign-in');
      }
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (flow === 'signIn') {
        const res = await signIn.attemptFirstFactor({ strategy: 'email_code', code });
        if (res.status !== 'complete') throw new Error('Additional verification required');
        await activateSignIn({ session: res.createdSessionId });
      } else {
        const res = await signUp.attemptEmailAddressVerification({ code });
        if (res.status !== 'complete') throw new Error('Additional verification required');
        await activateSignUp({ session: res.createdSessionId });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[shared.root, shared.scroll]}>
      <Text style={shared.appName}>Athlete Guide</Text>
      <View style={shared.card}>
        {phase === 'email' ? (
          <>
            <Text style={shared.cardTitle}>Sign in</Text>
            <Text style={shared.muted}>We'll email you a one-time code.</Text>
            <TextInput
              style={shared.input}
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
            />
            {error && <Text style={shared.errorText}>{error}</Text>}
            <Pressable style={shared.button} onPress={sendCode} disabled={busy || !email}>
              <Text style={shared.buttonText}>{busy ? 'Sending…' : 'Send code'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={shared.cardTitle}>Enter the code</Text>
            <Text style={shared.muted}>Sent to {email}</Text>
            <TextInput
              style={shared.input}
              placeholder="123456"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
            />
            {error && <Text style={shared.errorText}>{error}</Text>}
            <Pressable style={shared.button} onPress={verifyCode} disabled={busy || !code}>
              <Text style={shared.buttonText}>{busy ? 'Verifying…' : 'Continue'}</Text>
            </Pressable>
            <Pressable onPress={() => { setPhase('email'); setCode(''); setError(null); }}>
              <Text style={[shared.muted, { marginTop: 12 }]}>Use a different email</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}
