import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

/** Small shared atoms so all screens speak the same visual language. */

export function Chip({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: color }]}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

export function StatTile({ emoji, value, label }: { emoji: string; value: string; label: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statEmoji}>{emoji}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <View style={styles.statRow}>{children}</View>;
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${pct}%` }]} />
    </View>
  );
}

export function CheckCircle({ checked, onPress }: { checked: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={[styles.check, checked && styles.checkOn]}>
      {checked && <Text style={styles.checkMark}>✓</Text>}
    </Pressable>
  );
}

export function Logo() {
  return (
    <View style={styles.logoRow}>
      <Text style={styles.logoPuck}>🏒</Text>
      <Text style={styles.logoText}>ATHLETE GUIDE</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  chipText: { color: 'white', fontWeight: '800', fontSize: 10, letterSpacing: 0.6 },
  statRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  statTile: {
    flex: 1,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 2,
  },
  statEmoji: { fontSize: 18 },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '800' },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.track,
    overflow: 'hidden',
    marginTop: 10,
  },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.success },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkOn: { backgroundColor: colors.success, borderColor: colors.success },
  checkMark: { color: '#052E12', fontWeight: '900', fontSize: 14 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoPuck: { fontSize: 20 },
  logoText: {
    color: colors.primary,
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 2.5,
  },
});
