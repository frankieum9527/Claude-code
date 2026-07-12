import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChildDto, ChildrenResponse, MeResponse } from '@athlete-guide/shared-types';
import { API_URL } from './config';
import { colors } from './theme';
import { TodayScreen } from './screens/TodayScreen';
import { CoachTeamScreen } from './screens/CoachTeamScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { FamilyScreen } from './screens/FamilyScreen';

interface Props {
  getAuthHeaders: () => Promise<Record<string, string>>;
  onSignOut?: () => void;
  /** Dev demo bar's date-travel override, threaded to both tabs. */
  devDate?: string;
}

type Tab = 'today' | 'family' | 'coach';

/**
 * Role-aware container: everyone gets Today; users with a coach membership
 * also get the Coach tab, and guardians get the Family tab. A guardian's
 * Today tab can act for one of their children (x-child-id header) — kids
 * use the app on the guardian's device.
 */
export function Shell({ getAuthHeaders, onSignOut, devDate }: Props) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [kids, setKids] = useState<ChildDto[]>([]);
  const [tab, setTab] = useState<Tab>('today');
  /** Whose Today the Today tab shows: 'me' or a child id. */
  const [viewAs, setViewAs] = useState<string>('me');
  const autoRouted = useRef(false);

  const loadMe = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const [meRes, kidsRes] = await Promise.all([
        fetch(`${API_URL}/me`, { headers }),
        fetch(`${API_URL}/me/children`, { headers }),
      ]);
      if (meRes.ok) setMe((await meRes.json()) as MeResponse);
      if (kidsRes.ok) setKids(((await kidsRes.json()) as ChildrenResponse).children);
    } catch {
      // Today screen surfaces connectivity problems; the shell stays quiet.
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  // First load for a guardian: land where their next action is — the first
  // child's Today when one exists, otherwise the Family tab to add one.
  useEffect(() => {
    if (autoRouted.current || me?.user.role !== 'parent') return;
    autoRouted.current = true;
    if (kids.length > 0) setViewAs(kids[0].id);
    else setTab('family');
  }, [me, kids]);

  // The Today tab's requests act for the selected child.
  const actorHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const headers = await getAuthHeaders();
    return viewAs === 'me' ? headers : { ...headers, 'x-child-id': viewAs };
  }, [getAuthHeaders, viewAs]);

  const coachTeam = me?.memberships.find((m) => m.role === 'coach')?.team ?? null;
  const showFamily = me?.user.role === 'parent' || kids.length > 0;
  // Profile exists but no team yet → onboarding (me stays null pre-profile,
  // and the Today screen owns first-run registration). Guardians skip it —
  // their team joining happens per child on the Family tab.
  const needsOnboarding = me !== null && me.memberships.length === 0 && me.user.role !== 'parent';

  const tabs: [Tab, string][] = [['today', 'Today']];
  if (showFamily) tabs.push(['family', 'Family']);
  if (coachTeam) tabs.push(['coach', 'Coach']);

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
          <CoachTeamScreen
            teamId={coachTeam.id}
            getAuthHeaders={getAuthHeaders}
            dateOverride={devDate}
          />
        ) : tab === 'family' && showFamily ? (
          <FamilyScreen
            getAuthHeaders={getAuthHeaders}
            kids={kids}
            onChanged={loadMe}
            onViewChild={(childId) => {
              setViewAs(childId);
              setTab('today');
            }}
          />
        ) : (
          <View style={styles.content}>
            {kids.length > 0 && (
              <View style={styles.viewAsRow}>
                <Text style={styles.viewAsLabel}>VIEWING</Text>
                {[{ id: 'me', name: 'Me' }, ...kids].map((option) => (
                  <Pressable
                    key={option.id}
                    onPress={() => setViewAs(option.id)}
                    style={[styles.viewAsChip, viewAs === option.id && styles.viewAsChipActive]}
                  >
                    <Text
                      style={
                        viewAs === option.id ? styles.viewAsTextActive : styles.viewAsText
                      }
                    >
                      {option.name.split(' ')[0]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            <TodayScreen
              key={viewAs}
              getAuthHeaders={actorHeaders}
              onSignOut={onSignOut}
              onProfileChanged={loadMe}
              dateOverride={devDate}
            />
          </View>
        )}
      </View>
      {tabs.length > 1 && (
        <View style={styles.tabBar}>
          {tabs.map(([key, label]) => (
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
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.cardBorder,
    backgroundColor: colors.card,
    paddingBottom: 20,
    paddingTop: 8,
  },
  tabButton: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  tabLabel: { color: colors.muted, fontWeight: '700', fontSize: 15 },
  tabLabelActive: { color: colors.primary },
  viewAsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  viewAsLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  viewAsChip: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  viewAsChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  viewAsText: { color: colors.textSecondary, fontSize: 13 },
  viewAsTextActive: { color: colors.onPrimary, fontWeight: '800', fontSize: 13 },
});
