import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { API_URL } from '../config';
import { colors, shared } from '../theme';

interface Props {
  getAuthHeaders: () => Promise<Record<string, string>>;
  /** Called after the user gains their first team membership. */
  onDone: (path: 'coach' | 'player') => void;
}

/**
 * Shown when a signed-in user has no team memberships yet: coaches create a
 * team, players join one with the code their coach shared.
 */
export function OnboardingScreen({ getAuthHeaders, onDone }: Props) {
  const [teamName, setTeamName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createTeam = async () => {
    setBusy('create');
    setError(null);
    try {
      const res = await fetch(`${API_URL}/teams`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ name: teamName.trim(), sport: 'hockey' }),
      });
      if (!res.ok) throw new Error(`Could not create team (${res.status})`);
      onDone('coach');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const joinTeam = async () => {
    setBusy('join');
    setError(null);
    try {
      const res = await fetch(`${API_URL}/teams/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ joinCode: joinCode.trim() }),
      });
      if (res.status === 404) throw new Error('No team found with that code.');
      if (!res.ok) throw new Error(`Could not join team (${res.status})`);
      onDone('player');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={shared.root}>
      <ScrollView contentContainerStyle={shared.scroll}>
        <Text style={shared.appName}>Athlete Guide</Text>
        <Text style={styles.title}>Get started</Text>

        <View style={shared.card}>
          <Text style={shared.cardTitle}>Join your team</Text>
          <Text style={shared.muted}>Enter the code your coach shared.</Text>
          <TextInput
            style={shared.input}
            placeholder="e.g. 8F3A21C4"
            value={joinCode}
            onChangeText={setJoinCode}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Pressable
            style={shared.button}
            onPress={joinTeam}
            disabled={busy !== null || !joinCode.trim()}
          >
            <Text style={shared.buttonText}>{busy === 'join' ? 'Joining…' : 'Join team'}</Text>
          </Pressable>
        </View>

        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={shared.muted}>or</Text>
          <View style={styles.divider} />
        </View>

        <View style={shared.card}>
          <Text style={shared.cardTitle}>Coach a new team</Text>
          <Text style={shared.muted}>
            Create your team, then set the season and invite players.
          </Text>
          <TextInput
            style={shared.input}
            placeholder="Team name"
            value={teamName}
            onChangeText={setTeamName}
            autoCapitalize="words"
          />
          <Pressable
            style={shared.button}
            onPress={createTeam}
            disabled={busy !== null || !teamName.trim()}
          >
            <Text style={shared.buttonText}>
              {busy === 'create' ? 'Creating…' : 'Create team'}
            </Text>
          </Pressable>
        </View>

        {error && <Text style={shared.errorText}>{error}</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', marginTop: 8, color: colors.text },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  divider: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#CBD2D9' },
});
