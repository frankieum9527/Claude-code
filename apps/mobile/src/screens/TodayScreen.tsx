import { useCallback, useEffect, useRef, useState } from 'react';
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
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  CompletionsResponse,
  DayType,
  MySubmissionsResponse,
  ProgramItemDto,
  Role,
  SubmissionDto,
  TodayProfileDto,
  TodayResponse,
  WeekDayDto,
  WeekResponse,
} from '@athlete-guide/shared-types';
import { HOCKEY_FOCUS_AREAS } from '@athlete-guide/shared-types';
import { API_URL } from '../config';
import { localToday, shiftDate } from '../dates';
import { readTodayBundle, saveTodayBundle } from '../todayCache';
import {
  cancelReminders,
  ensurePermission,
  remindersSupported,
  syncReminders,
} from '../notifications';
import { colors, shared } from '../theme';
import { CelebrationBanner, CheckCircle, Chip, Logo, ProgressBar, StatRow, StatTile } from '../ui';

const REMINDERS_KEY = 'remindersOn';

/** Fire-and-forget haptics; a no-op wherever the platform lacks them. */
const buzzCheck = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
const buzzComplete = () =>
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

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

function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay
    ? time
    : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/** "3 × 8", "10 min", or nothing — the dose badge on a program item. */
function formatDose(item: ProgramItemDto): string {
  if (item.sets != null && item.reps != null) return `${item.sets} × ${item.reps}`;
  if (item.durationMin != null) return `${item.durationMin} min`;
  return '';
}

interface Props {
  /** Auth headers for API calls: bearer ID token (Firebase) or x-user-id (dev). */
  getAuthHeaders: () => Promise<Record<string, string>>;
  onSignOut?: () => void;
  /** Called after first-run registration succeeds (roles may have changed). */
  onProfileChanged?: () => void;
  /** Dev demo bar's date-travel override (YYYY-MM-DD); real today when unset. */
  dateOverride?: string;
}

export function TodayScreen({ getAuthHeaders, onSignOut, onProfileChanged, dateOverride }: Props) {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [week, setWeek] = useState<WeekDayDto[]>([]);
  // Week-strip selection; null = the anchor day (real today / demo override).
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Set to the cache's save time when we're showing offline data.
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingDrillId, setUploadingDrillId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0); // 0..1 for the active upload
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [doneItems, setDoneItems] = useState<Set<number>>(new Set());
  const [streak, setStreak] = useState(0);
  const [remindersOn, setRemindersOn] = useState(false);
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);
  // Rapid taps race their PUT responses; only the newest one may apply.
  const compSeq = useRef(0);

  // The strip anchors at the real (or demo-traveled) today; tapping a strip
  // day views that date. Selection resets when the anchor moves.
  const anchor = dateOverride ?? localToday();
  const viewDate = selectedDate ?? anchor;
  useEffect(() => {
    setSelectedDate(null);
  }, [dateOverride]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const headers = await getAuthHeaders();
      // Always classify the DEVICE's calendar day (or the demo override) —
      // the server's default "today" is UTC, which is tomorrow for evening
      // users west of Greenwich.
      const res = await fetch(`${API_URL}/me/today?date=${viewDate}`, {
        headers,
      });
      if (res.status === 403) {
        const body = (await res.json()) as { error?: string };
        if (body.error === 'no_profile') {
          setNeedsProfile(true);
          return;
        }
      }
      if (!res.ok) throw new Error(`API responded ${res.status}`);
      setNeedsProfile(false);
      setOfflineSince(null);
      const today = (await res.json()) as TodayResponse;
      setData(today);
      const seq = ++compSeq.current;
      const [compRes, subsRes, weekRes] = await Promise.all([
        fetch(`${API_URL}/me/completions?date=${today.date}`, { headers }),
        fetch(`${API_URL}/me/submissions`, { headers }),
        fetch(`${API_URL}/me/week?from=${anchor}`, { headers }),
      ]);
      let comp: CompletionsResponse | null = null;
      let weekDays: WeekDayDto[] = [];
      if (compRes.ok && seq === compSeq.current) {
        comp = (await compRes.json()) as CompletionsResponse;
        setDone(new Set(comp.drillIds));
        setDoneItems(new Set(comp.programItems));
        setStreak(comp.streak);
      }
      if (subsRes.ok) {
        setSubmissions(((await subsRes.json()) as MySubmissionsResponse).submissions);
      }
      if (weekRes.ok) {
        weekDays = ((await weekRes.json()) as WeekResponse).days;
        setWeek(weekDays);
      }
      // Cache the whole coherent bundle for offline cold opens.
      void saveTodayBundle(headers, { today, comp, week: weekDays });
    } catch (e) {
      // Network/API failure: fall back to the last saved day rather than an
      // error card, when we have one for this identity.
      const headers = await getAuthHeaders().catch(() => null);
      const cached = headers ? await readTodayBundle(headers) : null;
      if (cached && viewDate === anchor) {
        setData(cached.today);
        setWeek(cached.week);
        if (cached.comp) {
          setDone(new Set(cached.comp.drillIds));
          setDoneItems(new Set(cached.comp.programItems));
          setStreak(cached.comp.streak);
        }
        setOfflineSince(cached.savedAt);
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [getAuthHeaders, viewDate, anchor]);

  useEffect(() => {
    load();
  }, [load]);

  // Restore the reminders preference once on mount.
  useEffect(() => {
    AsyncStorage.getItem(REMINDERS_KEY).then((v) => setRemindersOn(v === '1'));
  }, []);

  // Reschedule whenever fresh week data lands while reminders are on, so
  // schedule changes propagate on the next app open (all local, no server).
  useEffect(() => {
    if (!remindersOn || week.length === 0) return;
    void syncReminders(week);
  }, [remindersOn, week]);

  const toggleReminders = async () => {
    setReminderNotice(null);
    if (!remindersSupported) {
      setReminderNotice('Reminders work on the iOS and Android app.');
      return;
    }
    if (remindersOn) {
      setRemindersOn(false);
      await AsyncStorage.setItem(REMINDERS_KEY, '0');
      await cancelReminders();
      setReminderNotice('Reminders off.');
      return;
    }
    if (!(await ensurePermission())) {
      setReminderNotice('Enable notifications for Upward in your device settings first.');
      return;
    }
    setRemindersOn(true);
    await AsyncStorage.setItem(REMINDERS_KEY, '1');
    const count = await syncReminders(week);
    setReminderNotice(
      count > 0 ? `On — ${count} reminder${count === 1 ? '' : 's'} scheduled this week.` : 'On.',
    );
  };

  const toggleDone = async (drillId: string) => {
    if (!data) return;
    const willBeDone = !done.has(drillId);
    // Optimistic flip; the PUT response is authoritative (incl. streak).
    const next = new Set(done);
    if (willBeDone) next.add(drillId);
    else next.delete(drillId);
    setDone(next);
    if (willBeDone) {
      const sessionComplete = data.routine?.items.every((i) => next.has(i.drill.id));
      void (sessionComplete ? buzzComplete() : buzzCheck());
    }
    const seq = ++compSeq.current;
    try {
      const res = await fetch(`${API_URL}/me/completions`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ date: data.date, drillId, done: willBeDone }),
      });
      if (!res.ok) throw new Error();
      const comp = (await res.json()) as CompletionsResponse;
      if (seq === compSeq.current) {
        setDone(new Set(comp.drillIds));
        setDoneItems(new Set(comp.programItems));
        setStreak(comp.streak);
      }
    } catch {
      if (seq === compSeq.current) await load(); // revert to server truth
    }
  };

  // Off-season sessions check off by item index (see PUT /me/completions).
  const toggleProgramItem = async (index: number) => {
    if (!data) return;
    const willBeDone = !doneItems.has(index);
    const next = new Set(doneItems);
    if (willBeDone) next.add(index);
    else next.delete(index);
    setDoneItems(next);
    if (willBeDone) {
      const total = data.program?.session?.items.length ?? 0;
      const sessionComplete = total > 0 && [...next].filter((i) => i < total).length === total;
      void (sessionComplete ? buzzComplete() : buzzCheck());
    }
    const seq = ++compSeq.current;
    try {
      const res = await fetch(`${API_URL}/me/completions`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ date: data.date, programItem: index, done: willBeDone }),
      });
      if (!res.ok) throw new Error();
      const comp = (await res.json()) as CompletionsResponse;
      if (seq === compSeq.current) {
        setDoneItems(new Set(comp.programItems));
        setStreak(comp.streak);
      }
    } catch {
      if (seq === compSeq.current) await load(); // revert to server truth
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Archive the active plan; the setup card reappears for a fresh one.
  const resetProgram = useCallback(async () => {
    try {
      await fetch(`${API_URL}/me/program`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
      });
    } finally {
      await load();
    }
  }, [getAuthHeaders, load]);

  const uploadForDrill = useCallback(
    async (drillId: string) => {
      setUploadNotice(null);
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
      });
      if (picked.canceled || !picked.assets[0]) return;
      setUploadingDrillId(drillId);
      setUploadProgress(0);
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
        // createUploadTask streams the file and reports byte progress, so a
        // large clip on rink Wi-Fi shows a filling bar instead of a frozen
        // "Uploading…". Falls back to uploadAsync where progress is missing.
        const task = FileSystem.createUploadTask(
          `${API_URL}${created.uploadUrl}`,
          picked.assets[0].uri,
          {
            httpMethod: 'PUT',
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers: { 'content-type': 'video/mp4', ...headers },
          },
          ({ totalBytesSent, totalBytesExpectedToSend }) => {
            if (totalBytesExpectedToSend > 0) {
              setUploadProgress(totalBytesSent / totalBytesExpectedToSend);
            }
          },
        );
        const upload = await task.uploadAsync();
        if (!upload || upload.status !== 200) {
          throw new Error(`Upload failed (${upload?.status ?? 'no response'})`);
        }
        setUploadProgress(1);
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
          : data.program
            ? data.program.session
              ? `${data.program.phaseName} phase — today's session is below.`
              : `${data.program.phaseName} phase — scheduled rest day. Recovery is training too.`
            : 'Build your personalized off-season plan below.'
    : '';

  return (
    <View style={shared.root}>
      <StatusBar style="dark" />
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

        {offlineSince && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>
              📴 Offline — showing your last saved day ({formatSavedAt(offlineSince)}).
            </Text>
          </View>
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

            {week.length > 0 && (
              <WeekStrip
                days={week}
                selected={viewDate}
                anchor={anchor}
                onSelect={(d) => setSelectedDate(d === anchor ? null : d)}
              />
            )}

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

                {data.routine.items.length > 0 &&
                  data.routine.items.every((i) => done.has(i.drill.id)) && (
                    <CelebrationBanner key={data.date} streak={streak} />
                  )}

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
                        <CheckCircle
                          checked={isDone}
                          onPress={() => toggleDone(item.drill.id)}
                          label={`Mark ${item.drill.title} done`}
                        />
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
                                  ? `Uploading… ${Math.round(uploadProgress * 100)}%`
                                  : '📹  Upload for coach review'}
                              </Text>
                              {uploadingDrillId === item.drill.id && (
                                <View style={styles.uploadProgress}>
                                  <ProgressBar done={Math.round(uploadProgress * 100)} total={100} />
                                </View>
                              )}
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

            {data.dayType === 'OFF_SEASON' && data.program && (
              <>
                {data.program.session && (
                  <StatRow>
                    <StatTile
                      emoji="✅"
                      value={`${[...doneItems].filter((i) => i < data.program!.session!.items.length).length}/${data.program.session.items.length}`}
                      label="exercises done"
                    />
                    <StatTile emoji="🔥" value={`${streak}`} label="day streak" />
                    <StatTile
                      emoji="⏱️"
                      value={`${data.program.session.items.reduce((s, i) => s + (i.durationMin ?? 5), 0)}`}
                      label="minutes"
                    />
                  </StatRow>
                )}
                {data.program.session &&
                  data.program.session.items.length > 0 &&
                  [...doneItems].filter((i) => i < data.program!.session!.items.length).length ===
                    data.program.session.items.length && (
                    <CelebrationBanner key={data.date} streak={streak} />
                  )}
                <View style={shared.card}>
                  <View style={styles.uploadTitleRow}>
                    <Text style={shared.sectionLabel}>Off-season plan</Text>
                    <Chip label={data.program.phaseName.toUpperCase()} color={colors.offseason} />
                  </View>
                  <Text style={[shared.muted, { marginTop: 6 }]}>{data.program.emphasis}</Text>
                  {data.program.session ? (
                    <>
                      <Text style={[shared.cardTitle, { marginTop: 12 }]}>
                        {data.program.session.title}
                      </Text>
                      {data.program.session.coachEdited && (
                        <View style={{ marginTop: 6 }}>
                          <Chip label="✏️ ADJUSTED BY YOUR COACH" color={colors.practice} />
                        </View>
                      )}
                      <ProgressBar
                        done={
                          [...doneItems].filter((i) => i < data.program!.session!.items.length)
                            .length
                        }
                        total={data.program.session.items.length}
                      />
                      {data.program.session.items.map((item, i) => {
                        const isDone = doneItems.has(i);
                        return (
                          <View key={i} style={styles.drillRow}>
                            <CheckCircle
                              checked={isDone}
                              onPress={() => toggleProgramItem(i)}
                              label={`Mark ${item.name} done`}
                            />
                            <View style={styles.drillBody}>
                              <View style={styles.drillTitleRow}>
                                <Text style={[styles.drillTitle, isDone && styles.drillTitleDone]}>
                                  {item.name}
                                </Text>
                                {formatDose(item) !== '' && (
                                  <Text style={styles.durText}>{formatDose(item)}</Text>
                                )}
                              </View>
                              {!isDone && <Text style={shared.muted}>{item.detail}</Text>}
                            </View>
                          </View>
                        );
                      })}
                    </>
                  ) : (
                    <Text style={styles.restText}>
                      😴 Nothing scheduled today — sleep, eat well, hydrate.
                    </Text>
                  )}
                  <Pressable onPress={resetProgram}>
                    <Text style={[shared.link, { marginTop: 14 }]}>Start a new plan</Text>
                  </Pressable>
                </View>
              </>
            )}

            {data.dayType === 'OFF_SEASON' && !data.program && (
              <ProgramSetupCard
                date={data.date}
                profile={data.profile}
                getAuthHeaders={getAuthHeaders}
                onCreated={load}
              />
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

            <View style={shared.card}>
              <View style={styles.reminderRow}>
                <View style={styles.reminderBody}>
                  <Text style={shared.cardTitle}>Reminders</Text>
                  <Text style={shared.muted}>
                    A morning heads-up for the day ahead, plus an hour before games and practices.
                  </Text>
                </View>
                <Pressable
                  onPress={toggleReminders}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: remindersOn }}
                  accessibilityLabel="Toggle training reminders"
                  style={[styles.reminderToggle, remindersOn && styles.reminderToggleOn]}
                >
                  <Text style={remindersOn ? styles.reminderToggleTextOn : styles.reminderToggleText}>
                    {remindersOn ? 'ON' : 'OFF'}
                  </Text>
                </Pressable>
              </View>
              {reminderNotice && (
                <Text style={[shared.muted, { marginTop: 10 }]}>{reminderNotice}</Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * Week-at-a-glance: seven tappable day cells from the anchor day. The dot
 * shows what the day holds — game, practice, home session, or a program
 * session; rest days get none. Tapping views that day.
 */
function WeekStrip({
  days,
  selected,
  anchor,
  onSelect,
}: {
  days: WeekDayDto[];
  selected: string;
  anchor: string;
  onSelect: (date: string) => void;
}) {
  const dotColor = (d: WeekDayDto): string | null => {
    if (d.event) return d.event.type === 'game' ? colors.game : colors.practice;
    if (d.dayType === 'IN_SEASON_OFF_DAY') return colors.home;
    if (d.programSession) return colors.offseason;
    return null;
  };
  return (
    <View style={styles.weekRow}>
      {days.map((d) => {
        const isSelected = d.date === selected;
        const dt = new Date(`${d.date}T12:00:00`);
        const dot = dotColor(d);
        return (
          <Pressable
            key={d.date}
            onPress={() => onSelect(d.date)}
            accessibilityRole="button"
            accessibilityLabel={`View ${d.date}`}
            style={[
              styles.weekCell,
              d.date === anchor && styles.weekCellToday,
              isSelected && styles.weekCellSelected,
            ]}
          >
            <Text style={[styles.weekDow, isSelected && styles.weekTextSelected]}>
              {dt.toLocaleDateString([], { weekday: 'narrow' })}
            </Text>
            <Text style={[styles.weekNum, isSelected && styles.weekTextSelected]}>
              {dt.getDate()}
            </Text>
            <View style={[styles.weekDot, dot ? { backgroundColor: dot } : styles.weekDotNone]} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Off-season with no active plan: collect inputs and generate one. */
function ProgramSetupCard({
  date,
  profile,
  getAuthHeaders,
  onCreated,
}: {
  /** The Today view's date — the plan starts here. */
  date: string;
  /** Known profile facts, so we don't re-ask what's already on file. */
  profile: TodayProfileDto;
  getAuthHeaders: () => Promise<Record<string, string>>;
  onCreated: () => void;
}) {
  const [focusAreas, setFocusAreas] = useState<string[]>(['Skating speed']);
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [weeks, setWeeks] = useState(12);
  // Age comes from the birthdate on file when we have one — never re-asked;
  // the server derives the safety band from it regardless (audit AG-3).
  const knownAge = profile.age;
  const [age, setAge] = useState('');
  const [heightCm, setHeightCm] = useState(profile.heightCm ? String(profile.heightCm) : '');
  const [weightKg, setWeightKg] = useState(profile.weightKg ? String(profile.weightKg) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleFocus = (area: string) => {
    setFocusAreas((prev) =>
      prev.includes(area)
        ? prev.filter((a) => a !== area)
        : prev.length >= 3
          ? prev
          : [...prev, area],
    );
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/me/program`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({
          startsOn: date,
          endsOn: shiftDate(date, weeks * 7 - 1),
          age: knownAge ?? Number(age),
          ...(heightCm ? { heightCm: Number(heightCm) } : {}),
          ...(weightKg ? { weightKg: Number(weightKg) } : {}),
          focusAreas,
          daysPerWeek,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(
          typeof body.error === 'string' ? body.error : `Couldn't build the plan (${res.status})`,
        );
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const ageNum = Number(age);
  const ageOk = knownAge != null || (Number.isInteger(ageNum) && ageNum >= 6 && ageNum <= 25);

  return (
    <View style={shared.card}>
      <Text style={shared.cardTitle}>Build your off-season plan</Text>
      <Text style={shared.muted}>
        Personalized from your age, size, and goals — recovery first, then strength, skills, and a
        pre-season ramp back to hockey shape.
      </Text>

      <Text style={[shared.sectionLabel, styles.setupLabel]}>Focus on (up to 3)</Text>
      <View style={styles.chipWrap}>
        {HOCKEY_FOCUS_AREAS.map((area) => {
          const on = focusAreas.includes(area);
          return (
            <Pressable
              key={area}
              onPress={() => toggleFocus(area)}
              style={[styles.roleChip, on && styles.roleChipActive]}
            >
              <Text style={on ? styles.roleChipTextActive : styles.roleChipText}>{area}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[shared.sectionLabel, styles.setupLabel]}>Training days per week</Text>
      <View style={styles.chipWrap}>
        {[2, 3, 4, 5, 6].map((n) => (
          <Pressable
            key={n}
            onPress={() => setDaysPerWeek(n)}
            style={[styles.roleChip, daysPerWeek === n && styles.roleChipActive]}
          >
            <Text style={daysPerWeek === n ? styles.roleChipTextActive : styles.roleChipText}>
              {n}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[shared.sectionLabel, styles.setupLabel]}>Plan length</Text>
      <View style={styles.chipWrap}>
        {[8, 12, 16].map((n) => (
          <Pressable
            key={n}
            onPress={() => setWeeks(n)}
            style={[styles.roleChip, weeks === n && styles.roleChipActive]}
          >
            <Text style={weeks === n ? styles.roleChipTextActive : styles.roleChipText}>
              {n} weeks
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[shared.sectionLabel, styles.setupLabel]}>About you</Text>
      {knownAge != null && (
        <Text style={[shared.muted, { marginTop: 6 }]}>Age {knownAge}, from your profile.</Text>
      )}
      <View style={styles.aboutRow}>
        {knownAge == null && (
          <TextInput
            style={[shared.input, styles.aboutInput]}
            placeholder="Age *"
            placeholderTextColor={colors.muted}
            value={age}
            onChangeText={setAge}
            keyboardType="number-pad"
          />
        )}
        <TextInput
          style={[shared.input, styles.aboutInput]}
          placeholder="Height cm"
          placeholderTextColor={colors.muted}
          value={heightCm}
          onChangeText={setHeightCm}
          keyboardType="number-pad"
        />
        <TextInput
          style={[shared.input, styles.aboutInput]}
          placeholder="Weight kg"
          placeholderTextColor={colors.muted}
          value={weightKg}
          onChangeText={setWeightKg}
          keyboardType="number-pad"
        />
      </View>

      {error && <Text style={shared.errorText}>{error}</Text>}
      <Pressable
        style={[shared.button, (!ageOk || focusAreas.length === 0) && styles.buttonDisabled]}
        onPress={submit}
        disabled={busy || !ageOk || focusAreas.length === 0}
      >
        <Text style={shared.buttonText}>{busy ? 'Building your plan…' : '✨ Generate my plan'}</Text>
      </Pressable>
      <Text style={[shared.muted, styles.setupFootnote]}>
        Volume and exercises are capped by age-appropriate safety limits.
      </Text>
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
  weekRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  weekCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 2,
  },
  weekCellToday: { borderColor: colors.cardBorder, backgroundColor: colors.card },
  weekCellSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  weekDow: { fontSize: 10, fontWeight: '800', color: colors.muted },
  weekNum: { fontSize: 15, fontWeight: '700', color: colors.text },
  weekTextSelected: { color: colors.onPrimary },
  weekDot: { width: 6, height: 6, borderRadius: 3, marginTop: 2 },
  weekDotNone: { backgroundColor: 'transparent' },
  uploadProgress: { width: '100%', marginTop: 8 },
  offlineBanner: {
    backgroundColor: colors.card,
    borderColor: colors.warn,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  offlineText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reminderBody: { flex: 1 },
  reminderToggle: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 54,
    alignItems: 'center',
  },
  reminderToggleOn: { backgroundColor: colors.success, borderColor: colors.success },
  reminderToggleText: { color: colors.muted, fontWeight: '800', fontSize: 12 },
  reminderToggleTextOn: { color: '#052E12', fontWeight: '800', fontSize: 12 },
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
    backgroundColor: '#F1EEDF',
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
  programRow: { marginTop: 12 },
  restText: { color: colors.textSecondary, marginTop: 14, fontSize: 15, lineHeight: 21 },
  setupLabel: { marginTop: 16 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  aboutRow: { flexDirection: 'row', gap: 8 },
  aboutInput: { flex: 1 },
  buttonDisabled: { opacity: 0.5 },
  setupFootnote: { marginTop: 10, fontSize: 12, textAlign: 'center' },
});
