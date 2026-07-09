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
import { useVideoPlayer, VideoView } from 'expo-video';
import type {
  ReviewQueueItemDto,
  ReviewQueueResponse,
  ScheduleEventDto,
  ScheduleResponse,
  TeamDetailResponse,
} from '@athlete-guide/shared-types';
import { API_URL } from '../config';
import { colors, shared } from '../theme';

interface Props {
  teamId: string;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function CoachTeamScreen({ teamId, getAuthHeaders }: Props) {
  const [detail, setDetail] = useState<TeamDetailResponse | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [queue, setQueue] = useState<ReviewQueueItemDto[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [feedUrl, setFeedUrl] = useState('');
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedNotice, setFeedNotice] = useState<string | null>(null);
  const [seasonName, setSeasonName] = useState('');
  const [seasonStart, setSeasonStart] = useState('');
  const [seasonEnd, setSeasonEnd] = useState('');
  const [seasonBusy, setSeasonBusy] = useState(false);
  const [seasonError, setSeasonError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const [detailRes, scheduleRes, queueRes] = await Promise.all([
        fetch(`${API_URL}/teams/${teamId}`, { headers }),
        fetch(`${API_URL}/teams/${teamId}/schedule`, { headers }),
        fetch(`${API_URL}/teams/${teamId}/review-queue`, { headers }),
      ]);
      if (!detailRes.ok) throw new Error(`API responded ${detailRes.status}`);
      if (!scheduleRes.ok) throw new Error(`API responded ${scheduleRes.status}`);
      setDetail((await detailRes.json()) as TeamDetailResponse);
      setSchedule((await scheduleRes.json()) as ScheduleResponse);
      if (queueRes.ok) setQueue(((await queueRes.json()) as ReviewQueueResponse).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [teamId, getAuthHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const connectFeed = async () => {
    setFeedBusy(true);
    setFeedNotice(null);
    try {
      const res = await fetch(`${API_URL}/teams/${teamId}/ics`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ url: feedUrl.trim() }),
      });
      const body = (await res.json()) as { error?: string; created?: number; skippedNoSeason?: number };
      if (!res.ok) throw new Error(body.error ?? `API responded ${res.status}`);
      setFeedNotice(`Imported ${body.created} events${body.skippedNoSeason ? ` (${body.skippedNoSeason} outside season windows)` : ''}.`);
      setFeedUrl('');
      await load();
    } catch (e) {
      setFeedNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setFeedBusy(false);
    }
  };

  const syncNow = async () => {
    setFeedBusy(true);
    setFeedNotice(null);
    try {
      const res = await fetch(`${API_URL}/teams/${teamId}/ics/sync`, {
        method: 'POST',
        headers: await getAuthHeaders(),
      });
      const body = (await res.json()) as {
        error?: string;
        created?: number;
        updated?: number;
        removed?: number;
      };
      if (!res.ok) throw new Error(body.error ?? `API responded ${res.status}`);
      setFeedNotice(`Synced: ${body.created} new, ${body.updated} updated, ${body.removed} removed.`);
      await load();
    } catch (e) {
      setFeedNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setFeedBusy(false);
    }
  };

  const createSeason = async () => {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(seasonStart.trim()) || !dateRe.test(seasonEnd.trim())) {
      setSeasonError('Dates must be YYYY-MM-DD.');
      return;
    }
    setSeasonBusy(true);
    setSeasonError(null);
    try {
      const res = await fetch(`${API_URL}/teams/${teamId}/seasons`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({
          name: seasonName.trim(),
          startsOn: seasonStart.trim(),
          endsOn: seasonEnd.trim(),
        }),
      });
      const body = (await res.json()) as { error?: unknown };
      if (!res.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : `API responded ${res.status}`);
      }
      await load();
    } catch (e) {
      setSeasonError(e instanceof Error ? e.message : String(e));
    } finally {
      setSeasonBusy(false);
    }
  };

  const fixEventType = async (event: ScheduleEventDto) => {
    const next = event.type === 'game' ? 'practice' : 'game';
    try {
      const res = await fetch(`${API_URL}/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ type: next }),
      });
      if (res.ok) await load();
    } catch {
      // surfaced on next refresh; keep the tap cheap
    }
  };

  if (error) {
    return (
      <View style={[shared.root, shared.scroll]}>
        <View style={shared.card}>
          <Text style={styles.errorTitle}>Can't load team</Text>
          <Text style={shared.muted}>{error}</Text>
        </View>
      </View>
    );
  }
  if (!detail || !schedule) {
    return (
      <View style={[shared.root, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const feed = detail.feed;
  const season = detail.seasons[0];

  return (
    <View style={shared.root}>
      <ScrollView
        contentContainerStyle={shared.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={shared.appName}>COACH VIEW</Text>
        <Text style={styles.title}>{detail.team.name}</Text>
        {season && (
          <Text style={shared.muted}>
            {season.name}: {season.startsOn} → {season.endsOn}
          </Text>
        )}

        <View style={shared.card}>
          <Text style={shared.cardTitle}>Invite players</Text>
          <Text style={styles.joinCode}>{detail.team.joinCode}</Text>
          <Text style={shared.muted}>Players enter this code to join the team.</Text>
        </View>

        {!season && (
          <View style={shared.card}>
            <Text style={shared.cardTitle}>Set up your season</Text>
            <Text style={shared.muted}>
              The season window drives everything: in-season vs off-season, and which imported
              events count.
            </Text>
            <TextInput
              style={shared.input}
              placeholder="Season name (e.g. 2026-27 Regular)"
              value={seasonName}
              onChangeText={setSeasonName}
            />
            <TextInput
              style={shared.input}
              placeholder="Starts on (YYYY-MM-DD)"
              value={seasonStart}
              onChangeText={setSeasonStart}
              autoCapitalize="none"
            />
            <TextInput
              style={shared.input}
              placeholder="Ends on (YYYY-MM-DD)"
              value={seasonEnd}
              onChangeText={setSeasonEnd}
              autoCapitalize="none"
            />
            {seasonError && <Text style={shared.errorText}>{seasonError}</Text>}
            <Pressable
              style={shared.button}
              onPress={createSeason}
              disabled={seasonBusy || !seasonName.trim() || !seasonStart || !seasonEnd}
            >
              <Text style={shared.buttonText}>
                {seasonBusy ? 'Creating…' : 'Create season'}
              </Text>
            </Pressable>
          </View>
        )}

        <View style={shared.card}>
          <Text style={shared.cardTitle}>Calendar feed</Text>
          {!season && !feed.icsUrl && (
            <Text style={shared.errorText}>
              Create your season first — imported events only land inside a season window.
            </Text>
          )}
          {feed.icsUrl ? (
            <>
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: feed.status === 'ok' ? '#1E8449' : colors.danger },
                  ]}
                />
                <Text style={shared.muted}>
                  {feed.status === 'ok' ? 'Healthy' : 'Failing'}
                  {feed.lastSyncedAt ? ` · synced ${timeAgo(feed.lastSyncedAt)}` : ''}
                </Text>
              </View>
              {feed.error && <Text style={shared.errorText}>{feed.error}</Text>}
              <Pressable style={shared.button} onPress={syncNow} disabled={feedBusy}>
                <Text style={shared.buttonText}>{feedBusy ? 'Syncing…' : 'Sync now'}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={shared.muted}>
                Paste a TeamSnap / SportsEngine / Spond calendar URL to import the schedule
                automatically.
              </Text>
              <TextInput
                style={shared.input}
                placeholder="webcal://ical-cdn.teamsnap.com/…"
                value={feedUrl}
                onChangeText={setFeedUrl}
                autoCapitalize="none"
              />
              <Pressable
                style={shared.button}
                onPress={connectFeed}
                disabled={feedBusy || !feedUrl.trim()}
              >
                <Text style={shared.buttonText}>{feedBusy ? 'Importing…' : 'Connect feed'}</Text>
              </Pressable>
            </>
          )}
          {feedNotice && <Text style={[shared.muted, { marginTop: 8 }]}>{feedNotice}</Text>}
        </View>

        <View style={shared.card}>
          <Text style={shared.cardTitle}>Review queue ({queue.length})</Text>
          {queue.length === 0 && (
            <Text style={shared.muted}>No videos waiting for review. 🎉</Text>
          )}
          {queue.map((item) =>
            reviewingId === item.id ? (
              <ReviewItem
                key={item.id}
                item={item}
                getAuthHeaders={getAuthHeaders}
                onDone={async () => {
                  setReviewingId(null);
                  await load();
                }}
                onClose={() => setReviewingId(null)}
              />
            ) : (
              <View key={item.id} style={styles.eventRow}>
                <View style={styles.eventBody}>
                  <Text style={styles.eventWhen}>{item.playerName}</Text>
                  <Text style={shared.muted}>
                    {item.drillTitle} · {timeAgo(item.createdAt)}
                  </Text>
                </View>
                <Pressable onPress={() => setReviewingId(item.id)} hitSlop={8}>
                  <Text style={styles.fixLink}>review</Text>
                </Pressable>
              </View>
            ),
          )}
        </View>

        <View style={shared.card}>
          <Text style={shared.cardTitle}>Next 30 days</Text>
          {schedule.events.length === 0 && (
            <Text style={shared.muted}>No events scheduled in this window.</Text>
          )}
          {schedule.events.map((event) => (
            <View key={event.id} style={styles.eventRow}>
              <View
                style={[
                  styles.typeChip,
                  { backgroundColor: event.type === 'game' ? colors.danger : colors.primary },
                ]}
              >
                <Text style={styles.typeChipText}>{event.type === 'game' ? 'GAME' : 'PRAC'}</Text>
              </View>
              <View style={styles.eventBody}>
                <Text style={styles.eventWhen}>{formatWhen(event.startsAt)}</Text>
                {(event.title || event.location) && (
                  <Text style={shared.muted}>
                    {[event.title, event.location].filter(Boolean).join(' — ')}
                  </Text>
                )}
              </View>
              <Pressable onPress={() => fixEventType(event)} hitSlop={8}>
                <Text style={styles.fixLink}>fix</Text>
              </Pressable>
            </View>
          ))}
        </View>

        <View style={shared.card}>
          <Text style={shared.cardTitle}>Roster ({detail.members.length})</Text>
          {detail.members.map((m) => (
            <View key={m.userId} style={styles.memberRow}>
              <Text style={styles.memberName}>{m.name}</Text>
              <Text style={shared.muted}>{m.membershipRole}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** Expanded review: video player + feedback box. Own component so the
 *  expo-video player hook mounts per expanded submission. */
function ReviewItem({
  item,
  getAuthHeaders,
  onDone,
  onClose,
}: {
  item: ReviewQueueItemDto;
  getAuthHeaders: () => Promise<Record<string, string>>;
  onDone: () => void;
  onClose: () => void;
}) {
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAuthHeaders().then(setHeaders);
  }, [getAuthHeaders]);

  const player = useVideoPlayer(
    headers ? { uri: `${API_URL}/submissions/${item.id}/video`, headers } : null,
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/submissions/${item.id}/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ body: body.trim() }),
      });
      if (!res.ok) throw new Error(`API responded ${res.status}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.reviewBox}>
      <View style={styles.reviewHeader}>
        <Text style={styles.eventWhen}>
          {item.playerName} — {item.drillTitle}
        </Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.fixLink}>close</Text>
        </Pressable>
      </View>
      <VideoView player={player} style={styles.video} nativeControls />
      <TextInput
        style={[shared.input, styles.feedbackInput]}
        placeholder="What looked good, what to fix, one focus cue…"
        value={body}
        onChangeText={setBody}
        multiline
      />
      {error && <Text style={shared.errorText}>{error}</Text>}
      <Pressable style={shared.button} onPress={submit} disabled={busy || !body.trim()}>
        <Text style={shared.buttonText}>{busy ? 'Sending…' : 'Send feedback'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', marginTop: 8, color: colors.text },
  joinCode: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 3,
    color: colors.primary,
    marginVertical: 4,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  typeChip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, width: 52, alignItems: 'center' },
  typeChipText: { color: 'white', fontWeight: '700', fontSize: 11 },
  eventBody: { flex: 1 },
  eventWhen: { fontSize: 15, fontWeight: '600', color: colors.text },
  fixLink: { color: colors.primary, fontWeight: '600' },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  memberName: { fontSize: 15, fontWeight: '600', color: colors.text },
  errorTitle: { fontSize: 16, fontWeight: '700', color: colors.danger },
  reviewBox: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#CBD2D9',
    borderRadius: 10,
    padding: 12,
  },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  video: { width: '100%', height: 220, borderRadius: 8, marginTop: 10, backgroundColor: '#000' },
  feedbackInput: { minHeight: 70, textAlignVertical: 'top' },
});
