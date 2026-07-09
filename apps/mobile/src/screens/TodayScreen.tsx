import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { DayType, Role, TodayResponse } from '@athlete-guide/shared-types';
import { API_URL } from '../config';
import { colors, shared } from '../theme';

const DAY_LABEL: Record<DayType, string> = {
  GAME_DAY: 'Game day',
  PRACTICE_DAY: 'Practice day',
  IN_SEASON_OFF_DAY: 'Home training day',
  OFF_SEASON: 'Off-season',
};

const DAY_COLOR: Record<DayType, string> = {
  GAME_DAY: '#C0392B',
  PRACTICE_DAY: '#2471A3',
  IN_SEASON_OFF_DAY: '#1E8449',
  OFF_SEASON: '#7D6608',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDuration(sec: number | null): string {
  if (sec == null) return '';
  return sec >= 60 ? `${Math.round(sec / 60)} min` : `${sec} s`;
}

interface Props {
  /** Auth headers for API calls: bearer ID token (Firebase) or x-user-id (dev). */
  getAuthHeaders: () => Promise<Record<string, string>>;
  onSignOut?: () => void;
}

export function TodayScreen({ getAuthHeaders, onSignOut }: Props) {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API_URL}/me/today`, { headers: await getAuthHeaders() });
      if (res.status === 403) {
        const body = (await res.json()) as { error?: string };
        if (body.error === 'no_profile') {
          setNeedsProfile(true);
          return;
        }
      }
      if (!res.ok) throw new Error(`API responded ${res.status}`);
      setNeedsProfile(false);
      setData((await res.json()) as TodayResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View style={shared.root}>
      <StatusBar style="auto" />
      <ScrollView
        contentContainerStyle={shared.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.headerRow}>
          <Text style={shared.appName}>Athlete Guide</Text>
          {onSignOut && (
            <Pressable onPress={onSignOut}>
              <Text style={styles.signOut}>Sign out</Text>
            </Pressable>
          )}
        </View>

        {needsProfile && <RegisterCard getAuthHeaders={getAuthHeaders} onRegistered={load} />}

        {error && !needsProfile && (
          <View style={shared.card}>
            <Text style={styles.errorTitle}>Can't reach the API</Text>
            <Text style={shared.muted}>{error}</Text>
            <Text style={shared.muted}>
              Check EXPO_PUBLIC_API_URL (see src/config.ts).
            </Text>
          </View>
        )}

        {!data && !error && !needsProfile && <ActivityIndicator style={styles.spinner} size="large" />}

        {data && !needsProfile && (
          <>
            <Text style={styles.date}>{data.date}</Text>
            {data.team && <Text style={styles.team}>{data.team.name}</Text>}

            <View style={[styles.dayBadge, { backgroundColor: DAY_COLOR[data.dayType] }]}>
              <Text style={styles.dayBadgeText}>{DAY_LABEL[data.dayType]}</Text>
            </View>

            {data.events.map((event) => (
              <View key={event.id} style={shared.card}>
                <Text style={shared.cardTitle}>
                  {event.type === 'game' ? 'Game' : 'Practice'} · {formatTime(event.startsAt)}
                </Text>
                {event.title && <Text style={shared.muted}>{event.title}</Text>}
                {event.location && <Text style={shared.muted}>{event.location}</Text>}
              </View>
            ))}

            {data.routine && (
              <View style={shared.card}>
                <Text style={shared.cardTitle}>{data.routine.title}</Text>
                {data.routine.items.map((item) => (
                  <View key={item.position} style={styles.drill}>
                    <Text style={styles.drillTitle}>
                      {item.position}. {item.drill.title}
                      {item.durationSec != null && (
                        <Text style={shared.muted}> · {formatDuration(item.durationSec)}</Text>
                      )}
                    </Text>
                    <Text style={shared.muted}>{item.drill.description}</Text>
                  </View>
                ))}
              </View>
            )}

            {data.dayType === 'OFF_SEASON' && !data.routine && (
              <View style={shared.card}>
                <Text style={shared.cardTitle}>Off-season</Text>
                <Text style={shared.muted}>
                  Personalized off-season programs arrive in Phase 3 — enjoy the rest day.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** First sign-in: the identity exists but has no app profile yet. */
function RegisterCard({
  getAuthHeaders,
  onRegistered,
}: {
  getAuthHeaders: () => Promise<Record<string, string>>;
  onRegistered: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('coach');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ name, email, role }),
      });
      if (!res.ok) throw new Error(`Registration failed (${res.status})`);
      onRegistered();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={shared.card}>
      <Text style={shared.cardTitle}>Finish setting up</Text>
      <Text style={shared.muted}>Tell us who you are to complete your account.</Text>
      <TextInput
        style={shared.input}
        placeholder="Full name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
      />
      <TextInput
        style={shared.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <View style={styles.roleRow}>
        {(['coach', 'parent', 'player'] as const).map((r) => (
          <Pressable
            key={r}
            onPress={() => setRole(r)}
            style={[styles.roleChip, role === r && styles.roleChipActive]}
          >
            <Text style={role === r ? styles.roleChipTextActive : styles.roleChipText}>{r}</Text>
          </Pressable>
        ))}
      </View>
      {error && <Text style={shared.errorText}>{error}</Text>}
      <Pressable style={shared.button} onPress={submit} disabled={busy || !name || !email}>
        <Text style={shared.buttonText}>{busy ? 'Saving…' : 'Continue'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  signOut: { color: colors.primary, fontWeight: '600' },
  date: { fontSize: 28, fontWeight: '700', marginTop: 8, color: colors.text },
  team: { fontSize: 16, color: colors.textSecondary, marginTop: 2 },
  dayBadge: {
    alignSelf: 'flex-start',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 12,
    marginBottom: 8,
  },
  dayBadgeText: { color: 'white', fontWeight: '700' },
  drill: { marginTop: 10 },
  drillTitle: { fontSize: 15, fontWeight: '600', color: '#323F4B' },
  errorTitle: { fontSize: 16, fontWeight: '700', color: colors.danger },
  spinner: { marginTop: 48 },
  roleRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  roleChip: {
    borderWidth: 1,
    borderColor: '#CBD2D9',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  roleChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleChipText: { color: colors.textSecondary },
  roleChipTextActive: { color: 'white', fontWeight: '600' },
});
