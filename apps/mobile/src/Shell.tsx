import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MeResponse } from '@athlete-guide/shared-types';
import { API_URL } from './config';
import { colors } from './theme';
import { TodayScreen } from './screens/TodayScreen';
import { CoachTeamScreen } from './screens/CoachTeamScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';

interface Props {
  getAuthHeaders: () => Promise<Record<string, string>>;
  onSignOut?: () => void;
  /** Dev demo bar's date-travel override, threaded to the Today view. */
  devDate?: string;
}

/**
 * Role-aware container: everyone gets Today; users with a coach membership
 * also get the Coach tab (first coached team — multi-team switching comes
 * with real demand).
 */
export function Shell({ getAuthHeaders, onSignOut, devDate }: Props) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tab, setTab] = useState<'today' | 'coach'>('today');

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/me`, { headers: await getAuthHeaders() });
      if (res.ok) setMe((await res.json()) as MeResponse);
    } catch {
      // Today screen surfaces connectivity problems; the shell stays quiet.
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const coachTeam = me?.memberships.find((m) => m.role === 'coach')?.team ?? null;
  // Profile exists but no team yet → onboarding (me stays null pre-profile,
  // and the Today screen owns first-run registration).
  const needsOnboarding = me !== null && me.memberships.length === 0;

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        {needsOnboarding ? (
          <OnboardingScreen
            getAuthHeaders={getAuthHeaders}
            onDone={async (path) => {
              await loadMe();
              setTab(path === 'coach' ? 'coach' : 'today');
            }}
          />
        ) : tab === 'coach' && coachTeam ? (
          <CoachTeamScreen teamId={coachTeam.id} getAuthHeaders={getAuthHeaders} />
        ) : (
          <TodayScreen
            getAuthHeaders={getAuthHeaders}
            onSignOut={onSignOut}
            onProfileChanged={loadMe}
            dateOverride={devDate}
          />
        )}
      </View>
      {coachTeam && (
        <View style={styles.tabBar}>
          {(
            [
              ['today', 'Today'],
              ['coach', 'Coach'],
            ] as const
          ).map(([key, label]) => (
            <Pressable key={key} style={styles.tabButton} onPress={() => setTab(key)}>
              <Text style={[styles.tabLabel, tab === key && styles.tabLabelActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#CBD2D9',
    backgroundColor: colors.card,
    paddingBottom: 20,
    paddingTop: 8,
  },
  tabButton: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  tabLabel: { color: colors.muted, fontWeight: '600', fontSize: 15 },
  tabLabelActive: { color: colors.primary },
});
