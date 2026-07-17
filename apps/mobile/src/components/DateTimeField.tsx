import { useState } from 'react';
import { Platform, Pressable, Text } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors, shared } from '../theme';

/**
 * Native date/time picker (iOS/Android). Renders a text-styled Pressable
 * that opens the platform picker; the web sibling (DateTimeField.web.tsx)
 * renders a DOM <input> instead. Both speak the same YYYY-MM-DD /
 * HH:MM string contract the API and screens already use, so the caller
 * never branches on platform.
 */
interface Props {
  mode: 'date' | 'time';
  /** YYYY-MM-DD for date mode, HH:MM for time mode. Empty string = unset. */
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Date mode only: latest selectable date, YYYY-MM-DD (e.g. today, for birthdates). */
  maximumDate?: string;
  /** Date mode only: where the picker starts when value is empty (defaults to today). */
  initialValue?: string;
}

function toDate(mode: 'date' | 'time', value: string, fallback?: string): Date {
  const source = value || fallback || '';
  if (mode === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(source)) {
    const [y, m, d] = source.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  if (mode === 'time' && /^\d{1,2}:\d{2}$/.test(source)) {
    const [h, min] = source.split(':').map(Number);
    const d = new Date();
    d.setHours(h, min, 0, 0);
    return d;
  }
  return new Date();
}

function fromDate(mode: 'date' | 'time', d: Date): string {
  if (mode === 'date') {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const h = `${d.getHours()}`.padStart(2, '0');
  const min = `${d.getMinutes()}`.padStart(2, '0');
  return `${h}:${min}`;
}

function formatDisplay(mode: 'date' | 'time', value: string): string | null {
  if (!value) return null;
  const d = toDate(mode, value);
  return mode === 'date'
    ? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function DateTimeField({
  mode,
  value,
  onChange,
  placeholder,
  maximumDate,
  initialValue,
}: Props) {
  const [open, setOpen] = useState(false);
  const display = formatDisplay(mode, value);

  return (
    <>
      <Pressable style={shared.input} onPress={() => setOpen(true)}>
        <Text style={display ? styles.value : styles.placeholder}>{display ?? placeholder}</Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={toDate(mode, value, initialValue)}
          mode={mode}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={maximumDate ? toDate('date', maximumDate) : undefined}
          onChange={(event, selected) => {
            // Android closes itself and fires "dismissed" on cancel; iOS
            // spinner stays open until the caller dismisses it explicitly.
            if (Platform.OS === 'android') setOpen(false);
            if (event.type === 'dismissed' || !selected) return;
            onChange(fromDate(mode, selected));
          }}
        />
      )}
      {open && Platform.OS === 'ios' && (
        <Pressable style={shared.buttonGhost} onPress={() => setOpen(false)}>
          <Text style={shared.buttonGhostText}>Done</Text>
        </Pressable>
      )}
    </>
  );
}

const styles = {
  value: { fontSize: 15, color: colors.text },
  placeholder: { fontSize: 15, color: colors.muted },
} as const;
