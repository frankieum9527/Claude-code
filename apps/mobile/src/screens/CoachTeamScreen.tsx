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
  AdherenceResponse,
  ReviewQueueItemDto,
  ReviewQueueResponse,
  ScheduleEventDto,
  ScheduleResponse,
  TeamDetailResponse,
  TeamProgramPlayerDto,
  TeamProgramsResponse,
} from '@athlete-guide/shared-types';
import { DateTimeField } from '../components/DateTimeField';
import { API_URL } from '../config';
import { localToday } from '../dates';
import { colors, shared } from '../theme';
import { ProgressBar, StatRow, StatTile } from '../ui';

interface Props {
  teamId: string;
  getAuthHeaders: () => Promise<Record<string, string>>;
  /** Dev demo bar's date-travel override (YYYY-MM-DD); real today when unset. */
  dateOverride?: string;
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

export function CoachTeamScreen({ teamId, getAuthHeaders, dateOverride }: Props) {
  const [detail, setDetail] = useState<TeamDetailResponse | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [queue, setQueue] = useState<ReviewQueueItemDto[]>([]);
  const [adherence, setAdherence] = useState<AdherenceResponse | null>(null);
  const [programs, setPrograms] = useState<TeamProgramsResponse | null>(null);
  const [expandedProgramId, setExpandedProgramId] = useState<string | null>(null);
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
  const [gamesFeedUrl, setGamesFeedUrl] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [evType, setEvType] = useState<'practice' | 'game'>('practice');
  const [evDate, setEvDate] = useState('');
  const [evTime, setEvTime] = useState('');
  const [evLocation, setEvLocation] = useState('');
  const [evBusy, setEvBusy] = useState(false);
  const [evError, setEvError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const programsQuery = `?date=${dateOverride ?? localToday()}`; // device-local day
      const [detailRes, scheduleRes, queueRes, adherenceRes, programsRes] = await Promise.all([
        fetch(`${API_URL}/teams/${teamId}`, { headers }),
        fetch(`${API_URL}/teams/${teamId}/schedule`, { headers }),
        fetch(`${API_URL}/teams/${teamId}/review-queue`, { headers }),
        fetch(`${API_URL}/teams/${teamId}/adherence`, { headers }),
        fetch(`${API_URL}/teams/${teamId}/programs${programsQuery}`, { headers }),
      ]);
      if (!detailRes.ok) throw new Error(`API responded ${detailRes.status}`);
      if (!scheduleRes.ok) throw new Error(`API responded ${scheduleRes.status}`);
      setDetail((await detailRes.json()) as TeamDetailResponse);
      setSchedule((await scheduleRes.json()) as ScheduleResponse);
      if (queueRes.ok) setQueue(((await queueRes.json()) as ReviewQueueResponse).items);
      if (adherenceRes.ok) setAdherence((await adherenceRes.json()) as AdherenceResponse);
      if (programsRes.ok) setPrograms((await programsRes.json()) as TeamProgramsResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [teamId, getAuthHeaders, dateOverride]);

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
        body: JSON.stringify({
          url: feedUrl.trim(),
          ...(gamesFeedUrl.trim() ? { gamesUrl: gamesFeedUrl.trim() } : {}),
        }),
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
      setSeasonError('Pick both a start and end date.');
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

  const addEvent = async () => {
    setEvError(null);
    const date = evDate.trim();
    const time = evTime.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) {
      setEvError('Pick a date and a start time.');
      return;
    }
    // No timezone suffix → parsed as device-local time, stored as the UTC instant.
    const when = new Date(`${date}T${time.padStart(5, '0')}:00`);
    if (Number.isNaN(when.getTime())) {
      setEvError('That date/time is invalid.');
      return;
    }
    const targetSeason = detail?.seasons.find((s) => s.startsOn <= date && date <= s.endsOn);
    if (!targetSeason) {
      setEvError('That date is outside every season window.');
      return;
    }
    setEvBusy(true);
    try {
      const res = await fetch(`${API_URL}/seasons/${targetSeason.id}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({
          type: evType,
          startsAt: when.toISOString(),
          ...(evLocation.trim() ? { location: evLocation.trim() } : {}),
        }),
      });
      const body = (await res.json()) as { error?: unknown };
      if (!res.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : `API responded ${res.status}`);
      }
      setEvDate('');
      setEvTime('');
      setEvLocation('');
      setAddOpen(false);
      await load();
    } catch (e) {
      setEvError(e instanceof Error ? e.message : String(e));
    } finally {
      setEvBusy(false);
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
  // The plans card earns its space when the team is between seasons or
  // someone already has a plan; in-season with no plans it stays hidden.
  const viewDate = programs?.date ?? localToday();
  const offSeasonNow = !detail.seasons.some((s) => s.startsOn <= viewDate && viewDate <= s.endsOn);
  const anyPlan = programs?.players.some((p) => p.program !== null) ?? false;

  return (
    <View style={shared.root}>
      <ScrollView
        contentContainerStyle={shared.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={shared.sectionLabel}>Coach view</Text>
        <Text style={shared.h1}>{detail.team.name}</Text>
        {season && (
          <Text style={shared.muted}>
            {season.name}: {season.startsOn} → {season.endsOn}
          </Text>
        )}

        <StatRow>
          <StatTile emoji="👥" value={`${detail.members.length}`} label="on roster" />
          <StatTile emoji="📥" value={`${queue.length}`} label="to review" />
          <StatTile emoji="📅" value={`${schedule.events.length}`} label="events · 30d" />
        </StatRow>

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
                placeholderTextColor={colors.muted}
              value={seasonName}
              onChangeText={setSeasonName}
            />
            <DateTimeField
              mode="date"
              placeholder="Starts on"
              value={seasonStart}
              onChange={setSeasonStart}
            />
            <DateTimeField
              mode="date"
              placeholder="Ends on"
              value={seasonEnd}
              onChange={setSeasonEnd}
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
                    { backgroundColor: feed.status === 'ok' ? colors.success : colors.danger },
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
                placeholderTextColor={colors.muted}
                value={feedUrl}
                onChangeText={setFeedUrl}
                autoCapitalize="none"
              />
              <TextInput
                style={shared.input}
                placeholder="Games-only feed URL (optional, exact game tagging)"
                placeholderTextColor={colors.muted}
                value={gamesFeedUrl}
                onChangeText={setGamesFeedUrl}
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

        {adherence && (
          <View style={shared.card}>
            <Text style={shared.sectionLabel}>Training adherence · last {adherence.days} days</Text>
            {adherence.players.length === 0 ? (
              <Text style={shared.muted}>
                No players on the roster yet. Share the join code above — adherence shows up
                here once they start training.
              </Text>
            ) : (
              adherence.players.map((p) => (
                <View key={p.userId} style={styles.adherenceRow}>
                  <View style={styles.adherenceHead}>
                    <Text style={styles.eventWhen}>{p.name}</Text>
                    <Text style={styles.adherenceStat}>
                      {p.activeDays}/{adherence.days} days · {p.completions} drills
                    </Text>
                  </View>
                  <ProgressBar done={p.activeDays} total={adherence.days} />
                  <Text style={shared.muted}>
                    {p.lastActiveOn ? `Last active ${p.lastActiveOn}` : 'No activity logged yet'}
                  </Text>
                </View>
              ))
            )}
          </View>
        )}

        {programs && programs.players.length > 0 && (offSeasonNow || anyPlan) && (
          <View style={shared.card}>
            <Text style={shared.sectionLabel}>Off-season plans · {programs.date}</Text>
            {!anyPlan && (
              <Text style={shared.muted}>
                No player has built a plan yet. Players create theirs from the Today screen
                once the season ends.
              </Text>
            )}
            {programs.players.map((p) => (
              <ProgramPlayerRow
                key={p.playerId}
                player={p}
                date={programs.date}
                expanded={expandedProgramId === p.playerId}
                onToggle={() =>
                  setExpandedProgramId(expandedProgramId === p.playerId ? null : p.playerId)
                }
                getAuthHeaders={getAuthHeaders}
                onChanged={load}
              />
            ))}
          </View>
        )}

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
                  <Text style={styles.fixLink}>{item.aiDraft ? '✨ review' : 'review'}</Text>
                </Pressable>
              </View>
            ),
          )}
        </View>

        <View style={shared.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={shared.cardTitle}>Next 30 days</Text>
            {season && (
              <Pressable onPress={() => setAddOpen(!addOpen)} hitSlop={8}>
                <Text style={styles.fixLink}>{addOpen ? 'cancel' : '+ add event'}</Text>
              </Pressable>
            )}
          </View>
          {addOpen && (
            <View style={styles.addBox}>
              <View style={styles.roleishRow}>
                {(['practice', 'game'] as const).map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setEvType(t)}
                    style={[styles.typeToggle, evType === t && styles.typeToggleActive]}
                  >
                    <Text style={evType === t ? styles.typeToggleTextActive : styles.typeToggleText}>
                      {t}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <DateTimeField mode="date" placeholder="Date" value={evDate} onChange={setEvDate} />
              <DateTimeField
                mode="time"
                placeholder="Start time (your local time)"
                value={evTime}
                onChange={setEvTime}
              />
              <TextInput
                style={shared.input}
                placeholder="Location (optional)"
                placeholderTextColor={colors.muted}
                value={evLocation}
                onChangeText={setEvLocation}
              />
              {evError && <Text style={shared.errorText}>{evError}</Text>}
              <Pressable
                style={shared.button}
                onPress={addEvent}
                disabled={evBusy || !evDate || !evTime}
              >
                <Text style={shared.buttonText}>{evBusy ? 'Adding…' : 'Add to schedule'}</Text>
              </Pressable>
            </View>
          )}
          {schedule.events.length === 0 && (
            <Text style={shared.muted}>
              {season
                ? 'Nothing on the calendar yet. Connect a feed above or tap “+ add event” to get your first practice or game on the board.'
                : 'Nothing on the calendar yet — set up your season above, then connect a feed or add events.'}
            </Text>
          )}
          {schedule.events.map((event) => (
            <View key={event.id} style={styles.eventRow}>
              <View
                style={[
                  styles.typeChip,
                  { backgroundColor: event.type === 'game' ? colors.game : colors.practice },
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

/** One roster player in the off-season plans card; tap to see the phases. */
function ProgramPlayerRow({
  player,
  date,
  expanded,
  onToggle,
  getAuthHeaders,
  onChanged,
}: {
  player: TeamProgramPlayerDto;
  date: string;
  expanded: boolean;
  onToggle: () => void;
  getAuthHeaders: () => Promise<Record<string, string>>;
  onChanged: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const program = player.program;
  if (!program) {
    return (
      <View style={styles.programRow}>
        <View style={styles.adherenceHead}>
          <Text style={styles.eventWhen}>{player.playerName}</Text>
          <Text style={shared.muted}>Hasn't built a plan yet</Text>
        </View>
      </View>
    );
  }
  const todayLine = program.today
    ? `Today: ${program.today.session.title}`
    : program.currentPhase
      ? 'Rest day today'
      : date < program.startsOn
        ? `Starts ${program.startsOn}`
        : `Ended ${program.endsOn}`;
  return (
    <Pressable style={styles.programRow} onPress={editing ? undefined : onToggle}>
      <View style={styles.adherenceHead}>
        <Text style={styles.eventWhen}>{player.playerName}</Text>
        <Text style={styles.adherenceStat}>
          {program.currentPhase ? program.currentPhase.toUpperCase() : 'PLANNED'}
        </Text>
      </View>
      <Text style={shared.muted}>{program.focusAreas.join(' · ')}</Text>
      <Text style={shared.muted}>{todayLine}</Text>
      {expanded && (
        <View style={styles.programDetail}>
          <Text style={styles.programSummary}>{program.summary}</Text>
          {program.phases.map((phase) => (
            <View key={phase.name} style={styles.adherenceHead}>
              <Text
                style={[
                  shared.muted,
                  phase.name === program.currentPhase && styles.programPhaseNow,
                ]}
              >
                {phase.name}
              </Text>
              <Text style={shared.muted}>
                {phase.startsOn} → {phase.endsOn} · {phase.sessionsPerWeek}×/wk
              </Text>
            </View>
          ))}
          {program.today && !editing && (
            <Pressable onPress={() => setEditing(true)} hitSlop={8}>
              <Text style={[styles.fixLink, styles.adjustLink]}>
                ✏️ Adjust today's session
              </Text>
            </Pressable>
          )}
          {program.today && editing && (
            <SessionEditor
              programId={program.id}
              phaseIndex={program.today.phaseIndex}
              weekday={program.today.weekday}
              session={program.today.session}
              getAuthHeaders={getAuthHeaders}
              onDone={async () => {
                setEditing(false);
                await onChanged();
              }}
              onClose={() => setEditing(false)}
            />
          )}
        </View>
      )}
    </Pressable>
  );
}

/** Inline editor for one session's content. Structure (phases, training
 *  days) is fixed by the plan; the server re-checks age guardrails. */
function SessionEditor({
  programId,
  phaseIndex,
  weekday,
  session,
  getAuthHeaders,
  onDone,
  onClose,
}: {
  programId: string;
  phaseIndex: number;
  weekday: number;
  session: { title: string; items: { name: string; detail: string; sets?: number; reps?: number; durationMin?: number }[] };
  getAuthHeaders: () => Promise<Record<string, string>>;
  onDone: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(session.title);
  const [items, setItems] = useState(
    session.items.map((item) => ({
      name: item.name,
      detail: item.detail,
      sets: item.sets?.toString() ?? '',
      reps: item.reps?.toString() ?? '',
      durationMin: item.durationMin?.toString() ?? '',
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = (i: number, field: string, value: string) => {
    setItems((prev) => prev.map((item, j) => (j === i ? { ...item, [field]: value } : item)));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const num = (s: string) => {
      const n = Number(s);
      return s.trim() !== '' && Number.isInteger(n) && n > 0 ? n : undefined;
    };
    try {
      const res = await fetch(
        `${API_URL}/programs/${programId}/phases/${phaseIndex}/days/${weekday}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', ...(await getAuthHeaders()) },
          body: JSON.stringify({
            title: title.trim(),
            items: items.map((item) => ({
              name: item.name.trim(),
              detail: item.detail.trim(),
              sets: num(item.sets),
              reps: num(item.reps),
              durationMin: num(item.durationMin),
            })),
          }),
        },
      );
      const body = (await res.json()) as { error?: unknown };
      if (!res.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : `API responded ${res.status}`,
        );
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const canSave =
    !busy && title.trim() !== '' && items.length > 0 &&
    items.every((item) => item.name.trim() !== '' && item.detail.trim() !== '');

  return (
    <View style={styles.editorBox}>
      <View style={styles.reviewHeader}>
        <Text style={styles.eventWhen}>Adjust session</Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.fixLink}>close</Text>
        </Pressable>
      </View>
      <TextInput
        style={shared.input}
        placeholder="Session title"
        placeholderTextColor={colors.muted}
        value={title}
        onChangeText={setTitle}
      />
      {items.map((item, i) => (
        <View key={i} style={styles.editorItem}>
          <View style={styles.reviewHeader}>
            <TextInput
              style={[shared.input, styles.editorName]}
              placeholder="Exercise"
              placeholderTextColor={colors.muted}
              value={item.name}
              onChangeText={(v) => setField(i, 'name', v)}
            />
            <Pressable
              onPress={() => setItems((prev) => prev.filter((_, j) => j !== i))}
              hitSlop={8}
            >
              <Text style={styles.removeLink}>remove</Text>
            </Pressable>
          </View>
          <TextInput
            style={shared.input}
            placeholder="How to do it"
            placeholderTextColor={colors.muted}
            value={item.detail}
            onChangeText={(v) => setField(i, 'detail', v)}
            multiline
          />
          <View style={styles.doseRow}>
            {(
              [
                ['sets', 'Sets'],
                ['reps', 'Reps'],
                ['durationMin', 'Min'],
              ] as const
            ).map(([field, label]) => (
              <TextInput
                key={field}
                style={[shared.input, styles.doseInput]}
                placeholder={label}
                placeholderTextColor={colors.muted}
                value={item[field]}
                onChangeText={(v) => setField(i, field, v)}
                keyboardType="number-pad"
              />
            ))}
          </View>
        </View>
      ))}
      <Pressable
        onPress={() =>
          setItems((prev) => [...prev, { name: '', detail: '', sets: '', reps: '', durationMin: '' }])
        }
        hitSlop={8}
      >
        <Text style={[styles.fixLink, styles.adjustLink]}>+ add exercise</Text>
      </Pressable>
      {error && <Text style={shared.errorText}>{error}</Text>}
      <Pressable style={shared.button} onPress={save} disabled={!canSave}>
        <Text style={shared.buttonText}>{busy ? 'Saving…' : 'Save session'}</Text>
      </Pressable>
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
  const [body, setBody] = useState(item.aiDraft ?? '');
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
      {item.aiDraft && (
        <Text style={styles.aiDraftLabel}>✨ AI draft — review and edit before sending</Text>
      )}
      <TextInput
        style={[shared.input, styles.feedbackInput]}
        placeholder="What looked good, what to fix, one focus cue…"
        placeholderTextColor={colors.muted}
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
    borderColor: colors.cardBorder,
    borderRadius: 10,
    padding: 12,
  },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  adherenceRow: { marginTop: 14 },
  adherenceHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  adherenceStat: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  programRow: { marginTop: 14 },
  programDetail: {
    marginTop: 8,
    borderLeftWidth: 2,
    borderLeftColor: colors.cardBorder,
    paddingLeft: 10,
    gap: 4,
  },
  programSummary: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  programPhaseNow: { color: colors.primary, fontWeight: '700' },
  adjustLink: { marginTop: 8 },
  editorBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    padding: 12,
  },
  editorItem: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingTop: 2,
  },
  editorName: { flex: 1, marginRight: 10 },
  removeLink: { color: colors.danger, fontWeight: '600', fontSize: 12 },
  doseRow: { flexDirection: 'row', gap: 8 },
  doseInput: { flex: 1 },
  addBox: { marginTop: 8 },
  roleishRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  typeToggle: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  typeToggleActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeToggleText: { color: colors.textSecondary },
  typeToggleTextActive: { color: colors.onPrimary, fontWeight: '800' },
  video: { width: '100%', height: 220, borderRadius: 8, marginTop: 10, backgroundColor: '#000' },
  feedbackInput: { minHeight: 110, textAlignVertical: 'top' },
  aiDraftLabel: { color: colors.warn, fontSize: 12, fontWeight: '700', marginTop: 10 },
});
