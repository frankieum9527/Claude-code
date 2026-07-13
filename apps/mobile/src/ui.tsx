import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
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

export function CheckCircle({
  checked,
  onPress,
  label,
}: {
  checked: boolean;
  onPress: () => void;
  label?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={[styles.check, checked && styles.checkOn]}
    >
      {checked && <Text style={styles.checkMark}>✓</Text>}
    </Pressable>
  );
}

/** Pops in when every item of the day's session is checked off. */
export function CelebrationBanner({ streak }: { streak: number }) {
  const scale = useRef(new Animated.Value(0.7)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [scale, opacity]);
  return (
    <Animated.View style={[styles.celebrate, { opacity, transform: [{ scale }] }]}>
      <Text style={styles.celebrateTitle}>Session complete! 🎉</Text>
      <Text style={styles.celebrateSub}>
        {streak >= 2 ? `${streak}-day streak — keep it rolling.` : 'Day one of a new streak.'}
      </Text>
    </Animated.View>
  );
}

/**
 * The Upward mark: forest badge with a gold upward triangle + Sora wordmark.
 * Proportions follow the brand spec (badge 64×64 @ 16px radius, glyph
 * ~26×20 centered), scaled to header size.
 */
export function Logo() {
  return (
    <View style={styles.logoRow}>
      <View style={styles.logoBadge}>
        <View style={styles.logoTriangle} />
      </View>
      <Text style={styles.logoText}>Upward</Text>
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
  celebrate: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    alignItems: 'center',
  },
  celebrateTitle: { color: colors.onPrimary, fontFamily: 'Sora_700Bold', fontSize: 16 },
  celebrateSub: { color: '#CBDCC9', marginTop: 3, fontSize: 13 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logoBadge: {
    width: 30,
    height: 30,
    borderRadius: 7.5, // 16/64 of the badge, per spec
    backgroundColor: colors.badge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 9.5, // ≈26×20 glyph scaled to the 30px badge
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colors.gold,
  },
  logoText: {
    color: colors.text,
    fontFamily: 'Sora_800ExtraBold',
    fontSize: 19,
    letterSpacing: -0.25,
  },
});
