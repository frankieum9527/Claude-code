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
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  DayType,
  MySubmissionsResponse,
  Role,
  SubmissionDto,
  TodayResponse,
} from '@athlete-guide/shared-types';
import { API_URL } from '../config';
import { colors, shared } from '../theme';
import { CheckCircle, Chip, Logo, ProgressBar, StatRow, StatTile } from '../ui';

const DAY_META: Record<DayType, { label: string; emoji: string; color: string }> = {
  GAME_DAY: { label: 'Game day', emoji: '🏒', color: colors.game },
  PRACTICE_DAY: { label: 'Practice day', emoji: '⛸️', color: colors.practice },
  IN_SEASON_OFF_DAY: { label: 'Home training day', emoji: '🏠', color: colors.home },
  OFF_SEASON: { label: 'Off-season', emoji: '🌴', color: colors.offseason },
};

const STATUS_META: Record<SubmissionDto['status'], { label: string; color: string }> = {
  pending_upload: { label: 'UPLOADING', color: colors.muted },
  ready_for_review: { label: 'WAITING FOR COACH', color: colors.warn },
  reviewed: { label: 'REVIEWED', color: colors.success },
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatLongDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatDuration(sec: number | null): string {
  if (sec == null) return '';
  return sec >= 60 ? `${Math.round(sec / 60)} min` : `${sec} s`;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface Props {
  /** Auth headers for API calls: bearer ID token (Firebase) or x-user-id (dev). */
  getAuthHeaders: () => Promise<Record<string, string>>;
  onSignOut?: () => void;
  /** Called after first-run registration succeeds (roles may have changed). */
  onProfileChanged?: () => void;
  /** Dev demo bar's date-travel override (YYYY-MM-DD); real today when unset. */
  dateOverride?: string;
  /** Scopes locally-stored drill completions (per signed-in user). */
  storageScope?: string;
}

export function TodayScreen({
  getAuthHeaders,
  onSignOut,
  onProfileChanged,
  dateOverride,
  storageScope = 'anon',
}: Props) {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingDrillId, setUploadingDrillId] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [streak, setStreak] = useState(0);

  const doneKey = (date: string) => `done:${storageScope}:${date}`;

  const computeStreak = useCallback(
    async (date: string) => {
      let count = 0;
      let cursor = date;
      for (let i = 0; i < 60; i++) {
        const raw = await AsyncStorage.getItem(doneKey(cursor));
        const any = raw ? (JSON.parse(raw) as string[]).length > 0 : false;
        if (!any) {
          // Today with nothing done yet doesn't break yesterday's streak.
          if (i === 0) {
            cursor = shiftDate(cursor, -1);
            continue;
          }
          break;
        }
        count++;
        cursor = shiftDate(cursor, -1);
      }
      setStreak(count);
    },
    [storageScope],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const query = dateOverride ? `?date=${dateOverride}` : '';
      const res = await fetch(`${API_URL}/me/today${query}`, { headers });
      if (res.status === 403) {
        const body = (await res.json()) as { error?: string };
        if (body.error === 'no_profile') {
          setNeedsProfile(true);
          return;
        }
      }
      if (!res.ok) throw new Error(`API responded ${res.status}`);
      setNeedsProfile(false);
      const today = (await res.json()) as TodayResponse;
      setData(today);
      const raw = await AsyncStorage.getItem(doneKey(today.date));
      setDone(new Set(raw ? (JSON.parse(raw) as string[]) : []));
      await computeStreak(today.date);
      const subsRes = await fetch(`${API_URL}/me/submissions`, { headers });
      if (subsRes.ok) {
        setSubmissions(((await subsRes.json()) as MySubmissionsResponse).submissions);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [getAuthHeaders, dateOverride, storageScope, computeStreak]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleDone = async (drillId: string) => {
    if (!data) return;
    const next = new Set(done);
    if (next.has(drillId)) next.delete(drillId);
    else next.add(drillId);
    setDone(next);
    await AsyncStorage.setItem(doneKey(data.date), JSON.stringify([...next]));
    await computeStreak(data.date);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

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
        setUploadNotice('Video sent to your coach for review. 🎉');
        await load();
      } catch (e) {
        setUploadNotice(e instanceof Error ? e.message : String(e));
      } finally {
        setUploadingDrillId(null);
      }
    },
    [getAuthHeaders, load],
  );

  const meta = data ? DAY_META[data.dayType] : null;
  const firstEvent = data?.events[0];
  const heroSub = data
    ? data.dayType === 'GAME_DAY' && firstEvent
      ? `Puck drops ${formatTime(firstEvent.startsAt)}${firstEvent.location ? ` · ${firstEvent.location}` : ''}`
      : data.dayType === 'PRACTICE_DAY' && firstEvent
        ? `Practice at ${formatTime(firstEvent.startsAt)}${firstEvent.location ? ` · ${firstEvent.location}` : ''}`
        : data.dayType === 'IN_SEASON_OFF_DAY'
          ? 'No team events — your home session is below.'
          : 'Recovery time. Personalized programs arrive in Phase 3.'
    : '';

  return (
    <View style={shared.root}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={shared.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
        }
      >
        <View style={styles.headerRow}>
          <Logo />
          {onSignOut && (
            <Pressable onPress={onSignOut}>
              <Text style={shared.link}>Sign out</Text>
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
              Is the API running (npm run api)? In Codespaces, set port 3000's visibility to
              Public in the Ports panel.
            </Text>
          </View>
        )}

        {!data && !error && !needsProfile && (
          <ActivityIndicator style={styles.spinner} size="large" color={colors.primary} />
        )}

        {data && !needsProfile && meta && (
          <>
            {data.team && <Text style={[shared.sectionLabel, styles.teamLabel]}>{data.team.name}</Text>}
            <Text style={shared.h1}>{formatLongDate(data.date)}</Text>

            <View style={[styles.hero, { borderColor: meta.color }]}>
              <Text style={styles.heroEmoji}>{meta.emoji}</Text>
              <View style={styles.heroBody}>
                <Text style={[styles.heroTitle, { color: meta.color }]}>{meta.label}</Text>
                <Text style={shared.muted}>{heroSub}</Text>
              </View>
            </View>

            {data.events.slice(1).map((event) => (
              <View key={event.id} style={shared.card}>
                <Text style={shared.cardTitle}>
                  {event.type === 'game' ? 'Game' : 'Practice'} · {formatTime(event.startsAt)}
                </Text>
                {event.title && <Text style={shared.muted}>{event.title}</Text>}
                {event.location && <Text style={shared.muted}>{event.location}</Text>}
              </View>
            ))}

            {data.routine && (
              <>
                <StatRow>
                  <StatTile
                    emoji="✅"
                    value={`${[...done].filter((id) => data.routine!.items.some((i) => i.drill.id === id)).length}/${data.routine.items.length}`}
                    label="drills done"
                  />
                  <StatTile emoji="🔥" value={`${streak}`} label="day streak" />
                  <StatTile
                    emoji="⏱️"
                    value={`${Math.round(
                      data.routine.items.reduce((s, i) => s + (i.durationSec ?? 0), 0) / 60,
                    )}`}
                    label="minutes"
                  />
                </StatRow>

                <View style={shared.card}>
                  <Text style={shared.sectionLabel}>Today's session</Text>
                  <Text style={[shared.cardTitle, { marginTop: 4 }]}>{data.routine.title}</Text>
                  <ProgressBar
                    done={
                      [...done].filter((id) => data.routine!.items.some((i) => i.drill.id === id))
                        .length
                    }
                    total={data.routine.items.length}
                  />
                  {data.routine.items.map((item) => {
                    const isDone = done.has(item.drill.id);
                    return (
                      <View key={item.position} style={styles.drillRow}>
                        <CheckCircle checked={isDone} onPress={() => toggleDone(item.drill.id)} />
                        <View style={styles.drillBody}>
                          <View style={styles.drillTitleRow}>
                            <Text style={[styles.drillTitle, isDone && styles.drillTitleDone]}>
                              {item.drill.title}
                            </Text>
                            {item.durationSec != null && (
                              <Text style={styles.durText}>{formatDuration(item.durationSec)}</Text>
                            )}
                          </View>
                          {!isDone && <Text style={shared.muted}>{item.drill.description}</Text>}
                          {data.routine?.kind === 'home_session' && (
                            <Pressable
                              style={shared.buttonGhost}
                              onPress={() => uploadForDrill(item.drill.id)}
                              disabled={uploadingDrillId !== null}
                            >
                              <Text style={shared.buttonGhostText}>
                                {uploadingDrillId === item.drill.id
                                  ? 'Uploading…'
                                  : '📹  Upload for coach review'}
                              </Text>
                            </Pressable>
                          )}
                        </View>
                      </View>
                    );
                  })}
                  {uploadNotice && (
                    <Text style={[shared.muted, { marginTop: 12 }]}>{uploadNotice}</Text>
                  )}
                </View>
              </>
            )}

            {submissions.length > 0 && (
              <View style={shared.card}>
                <Text style={shared.sectionLabel}>My uploads</Text>
                {submissions.map((sub) => (
                  <View key={sub.id} style={styles.uploadRow}>
                    <View style={styles.uploadTitleRow}>
                      <Text style={styles.drillTitle}>{sub.drill.title}</Text>
                      <Chip
                        label={STATUS_META[sub.status].label}
                        color={STATUS_META[sub.status].color}
                      />
                    </View>
                    {sub.feedback.map((f) => (
                      <View key={f.id} style={styles.feedbackBox}>
                        <Text style={styles.feedbackAuthor}>
                          {f.author === 'coach' ? (f.authorName ?? 'Coach') : 'AI suggestion'}
                        </Text>
                        <Text style={styles.feedbackBody}>{f.body}</Text>
                      </View>
                    ))}
                  </View>
                ))}
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
        placeholderTextColor={colors.muted}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
      />
      <TextInput
        style={shared.input}
        placeholder="Email"
        placeholderTextColor={colors.muted}
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  teamLabel: { marginBottom: 4 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderLeftWidth: 5,
    borderRadius: 16,
    padding: 16,
    marginTop: 14,
    borderColor: colors.cardBorder,
  },
  heroEmoji: { fontSize: 34 },
  heroBody: { flex: 1 },
  heroTitle: { fontSize: 20, fontWeight: '800' },
  drillRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  drillBody: { flex: 1 },
  drillTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  drillTitle: { fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1 },
  drillTitleDone: { color: colors.muted, textDecorationLine: 'line-through' },
  durText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  uploadRow: { marginTop: 14 },
  uploadTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  feedbackBox: {
    backgroundColor: '#0F1828',
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
  },
  feedbackAuthor: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  feedbackBody: { color: colors.textSecondary, marginTop: 2, lineHeight: 19, fontSize: 13 },
  errorTitle: { fontSize: 16, fontWeight: '800', color: colors.danger },
  spinner: { marginTop: 48 },
  roleRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  roleChip: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  roleChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleChipText: { color: colors.textSecondary },
  roleChipTextActive: { color: colors.onPrimary, fontWeight: '800' },
});
