import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DevPersonaDto } from '@athlete-guide/shared-types';

/**
 * Dev-mode demo bar (never rendered in Firebase mode): switch between demo
 * personas and time-travel the Today view, so the whole app is explorable
 * by clicking — practice/game/off/off-season days, player and coach views.
 */
interface Props {
  personas: DevPersonaDto[];
  currentId: string;
  onSwitch: (id: string) => void;
  onNewUser: () => void;
  date: string;
  isToday: boolean;
  onShiftDate: (days: number) => void;
  onResetDate: () => void;
}

function personaLabel(p: DevPersonaDto): string {
  const membership = p.teams[0];
  return membership ? `${p.name} (${membership.membershipRole})` : p.name;
}

export function DevBar({
  personas,
  currentId,
  onSwitch,
  onNewUser,
  date,
  isToday,
  onShiftDate,
  onResetDate,
}: Props) {
  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <Text style={styles.label}>DEMO</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {personas.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => onSwitch(p.id)}
              style={[styles.chip, p.id === currentId && styles.chipActive]}
            >
              <Text style={p.id === currentId ? styles.chipTextActive : styles.chipText}>
                {personaLabel(p)}
              </Text>
            </Pressable>
          ))}
          <Pressable onPress={onNewUser} style={styles.chip}>
            <Text style={styles.chipText}>+ new user</Text>
          </Pressable>
        </ScrollView>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>DATE</Text>
        <Pressable onPress={() => onShiftDate(-1)} style={styles.chip} hitSlop={6}>
          <Text style={styles.chipText}>◀</Text>
        </Pressable>
        <Text style={styles.dateText}>{date}</Text>
        <Pressable onPress={() => onShiftDate(1)} style={styles.chip} hitSlop={6}>
          <Text style={styles.chipText}>▶</Text>
        </Pressable>
        {!isToday && (
          <Pressable onPress={onResetDate} style={styles.chip}>
            <Text style={styles.chipText}>today</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#1F2933',
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 10,
    gap: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { color: '#7B8794', fontSize: 10, fontWeight: '800', letterSpacing: 1, width: 40 },
  chip: {
    borderWidth: 1,
    borderColor: '#3E4C59',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
  },
  chipActive: { backgroundColor: '#2471A3', borderColor: '#2471A3' },
  chipText: { color: '#CBD2D9', fontSize: 12 },
  chipTextActive: { color: 'white', fontSize: 12, fontWeight: '700' },
  dateText: { color: 'white', fontSize: 13, fontWeight: '700', minWidth: 86, textAlign: 'center' },
});
