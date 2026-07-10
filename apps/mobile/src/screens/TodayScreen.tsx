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
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import type {
  DayType,
  MySubmissionsResponse,
  Role,
  SubmissionDto,
  TodayResponse,
} from '@athlete-guide/shared-types';
import { API_URL } from '../config';
import { colors, shared } from '../theme';

const STATUS_LABEL: Record<SubmissionDto['status'], string> = {
  pending_upload: 'Uploading…',
  ready_for_review: 'Waiting for coach',
  reviewed: 'Reviewed',
};

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
  /** Called after first-run registration succeeds (roles may have changed). */
  onProfileChanged?: () => void;
}

export function TodayScreen({ getAuthHeaders, onSignOut, onProfileChanged }: Props) {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingDrillId, setUploadingDrillId] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/me/today`, { headers });
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
      const subsRes = await fetch(`${API_URL}/me/submissions`, { headers });
      if (subsRes.ok) {
        setSubmissions(((await subsRes.json()) as MySubmissionsResponse).submissions);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [getAuthHeaders]);

  const uploadForDrill = useCallback(
    async (drillId: string) => {
      setUploadNotice(null);
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
      });
      if (picked.canceled || !picked.assets[0]) return;
      setUploadingDrillId(drillId);
      try {
        const headers = await getAuthHeaders();
        const createRes = await fetch(`${API_URL}/submissions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ drillId }),
        });
        const created = (await createRes.json()) as {
          uploadUrl?: string;
          error?: string;
          hint?: string;
        };
        if (!createRes.ok || !created.uploadUrl) {
          throw new Error(
            created.error === 'consent_required'
              ? (created.hint ?? 'Parental consent is required for video uploads.')
              : (created.error ?? `API responded ${createRes.status}`),
          );
        }
        const upload = await FileSystem.uploadAsync(
          `${API_URL}${created.uploadUrl}`,
          picked.assets[0].uri,
          { httpMethod: 'PUT', headers: { 'content-type': 'video/mp4', ...headers } },
        );
        if (upload.status !== 200) throw new Error(`Upload failed (${upload.status})`);
        setUploadNotice('Video sent to your coach for review.');
        await load();
      } catch (e) {
        setUploadNotice(e instanceof Error ? e.message : String(e));
      } finally {
        setUploadingDrillId(null);
      }
    },
    [getAuthHeaders, load],
  );

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

        {needsProfile && (
          <RegisterCard
            getAuthHeaders={getAuthHeaders}
            onRegistered={() => {
              load();
              onProfileChanged?.();
            }}
          />
        )}

        {error && !needsProfile && (
          <View style={shared.card}>
            <Text style={styles.errorTitle}>Can't reach the API</Text>
            <Text style={shared.muted}>{error}</Text>
            <Text style={shared.muted}>Tried: {API_URL}</Text>
            <Text style={shared.muted}>
              Is the API running (npm run api)? In Codespaces, set port 3000's
              visibility to Public in the Ports panel.
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
                    {data.routine?.kind === 'home_session' && (
                      <Pressable
                        onPress={() => uploadForDrill(item.drill.id)}
                        disabled={uploadingDrillId !== null}
                      >
                        <Text style={styles.uploadLink}>
                          {uploadingDrillId === item.drill.id
                            ? 'Uploading…'
                            : '📹 Upload video for coach review'}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ))}
                {uploadNotice && <Text style={[shared.muted, { marginTop: 12 }]}>{uploadNotice}</Text>}
              </View>
            )}

            {submissions.length > 0 && (
              <View style={shared.card}>
                <Text style={shared.cardTitle}>My uploads</Text>
                {submissions.map((sub) => (
                  <View key={sub.id} style={styles.drill}>
                    <Text style={styles.drillTitle}>
                      {sub.drill.title}
                      <Text style={shared.muted}> · {STATUS_LABEL[sub.status]}</Text>
                    </Text>
                    {sub.feedback.map((f) => (
                      <Text key={f.id} style={shared.muted}>
                        {f.author === 'coach' ? (f.authorName ?? 'Coach') : 'AI suggestion'}: {f.body}
                      </Text>
                    ))}
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
  uploadLink: { color: colors.primary, fontWeight: '600', marginTop: 4 },
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
