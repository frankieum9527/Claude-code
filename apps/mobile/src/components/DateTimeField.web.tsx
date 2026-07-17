import type { CSSProperties } from 'react';
import { colors } from '../theme';

/**
 * Web sibling of DateTimeField.tsx — Metro resolves this file for web
 * builds. Renders a native DOM date/time input (browser-native picker UI)
 * instead of the @react-native-community/datetimepicker modal, which has
 * no web implementation. Same YYYY-MM-DD / HH:MM string contract.
 */
interface Props {
  mode: 'date' | 'time';
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Date mode only: latest selectable date, YYYY-MM-DD (e.g. today, for birthdates). */
  maximumDate?: string;
  /** Date mode only: unused on web — the browser picker opens on today by default. */
  initialValue?: string;
}

export function DateTimeField({ mode, value, onChange, placeholder, maximumDate }: Props) {
  return (
    <input
      type={mode}
      value={value}
      placeholder={placeholder}
      max={mode === 'date' ? maximumDate : undefined}
      onChange={(e) => onChange(e.target.value)}
      style={style}
    />
  );
}

const style: CSSProperties = {
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: 12,
  padding: '12px 14px',
  marginTop: 10,
  fontSize: 15,
  color: colors.text,
  backgroundColor: '#FDFCF6',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  outline: 'none',
};
