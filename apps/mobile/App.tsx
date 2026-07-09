import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { DayType, TodayResponse } from '@athlete-guide/shared-types';
import { API_URL, DEV_USER_ID } from './src/config';

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

export default function App() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API_URL}/me/today`, {
        headers: { 'x-user-id': DEV_USER_ID },
      });
      if (!res.ok) throw new Error(`API responded ${res.status}`);
      setData((await res.json()) as TodayResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.appName}>Athlete Guide</Text>

        {error && (
          <View style={styles.card}>
            <Text style={styles.errorTitle}>Can't reach the API</Text>
            <Text style={styles.muted}>{error}</Text>
            <Text style={styles.muted}>
              Check EXPO_PUBLIC_API_URL and EXPO_PUBLIC_DEV_USER_ID (see src/config.ts).
            </Text>
          </View>
        )}

        {!data && !error && <ActivityIndicator style={styles.spinner} size="large" />}

        {data && (
          <>
            <Text style={styles.date}>{data.date}</Text>
            {data.team && <Text style={styles.team}>{data.team.name}</Text>}

            <View style={[styles.dayBadge, { backgroundColor: DAY_COLOR[data.dayType] }]}>
              <Text style={styles.dayBadgeText}>{DAY_LABEL[data.dayType]}</Text>
            </View>

            {data.events.map((event) => (
              <View key={event.id} style={styles.card}>
                <Text style={styles.cardTitle}>
                  {event.type === 'game' ? 'Game' : 'Practice'} · {formatTime(event.startsAt)}
                </Text>
                {event.title && <Text style={styles.muted}>{event.title}</Text>}
                {event.location && <Text style={styles.muted}>{event.location}</Text>}
              </View>
            ))}

            {data.routine && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{data.routine.title}</Text>
                {data.routine.items.map((item) => (
                  <View key={item.position} style={styles.drill}>
                    <Text style={styles.drillTitle}>
                      {item.position}. {item.drill.title}
                      {item.durationSec != null && (
                        <Text style={styles.muted}> · {formatDuration(item.durationSec)}</Text>
                      )}
                    </Text>
                    <Text style={styles.muted}>{item.drill.description}</Text>
                  </View>
                ))}
              </View>
            )}

            {data.dayType === 'OFF_SEASON' && !data.routine && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Off-season</Text>
                <Text style={styles.muted}>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F6F7' },
  scroll: { padding: 20, paddingTop: 72 },
  appName: { fontSize: 14, fontWeight: '600', color: '#7B8794', letterSpacing: 1 },
  date: { fontSize: 28, fontWeight: '700', marginTop: 8, color: '#1F2933' },
  team: { fontSize: 16, color: '#52606D', marginTop: 2 },
  dayBadge: {
    alignSelf: 'flex-start',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 12,
    marginBottom: 8,
  },
  dayBadgeText: { color: 'white', fontWeight: '700' },
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#1F2933', marginBottom: 4 },
  drill: { marginTop: 10 },
  drillTitle: { fontSize: 15, fontWeight: '600', color: '#323F4B' },
  muted: { color: '#7B8794', marginTop: 2, lineHeight: 19 },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#C0392B' },
  spinner: { marginTop: 48 },
});
