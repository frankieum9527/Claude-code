import { StyleSheet } from 'react-native';

/**
 * Upward brand — forest tone. Warm off-white surfaces, forest-green primary,
 * gold / terracotta / blue accents (see docs/BRAND.md). Day accents are
 * deepened variants of the brand accents so they stay readable as text and
 * chip fills on the light background.
 */
export const colors = {
  bg: '#F4F2E7', // warm off-white
  card: '#FFFFFF',
  cardBorder: '#E3DFCF',
  text: '#1A2E1E', // deep forest (icon-on-green tone)
  textSecondary: '#4C5B50',
  muted: '#7D8A7F',
  primary: '#264C34', // forest green
  onPrimary: '#F4F2E7',
  success: '#3E7C53',
  warn: '#8F7420', // deep gold — readable on light surfaces
  danger: '#9C5540', // deep terracotta — readable on light surfaces
  track: '#E7E3D2',
  // raw brand accents (decorative fills, the logo triangle)
  gold: '#D6BD5C',
  terracotta: '#BE7C65',
  blue: '#6A839E',
  badge: '#1A2E1E',
  // day-type accents (deepened for text/chips on light bg)
  game: '#A8563C',
  practice: '#4E6A8A',
  home: '#2F6B44',
  offseason: '#8F7420',
};

export const shared = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingTop: 64, paddingBottom: 32 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
  },
  cardTitle: { fontSize: 17, fontFamily: 'Sora_700Bold', color: colors.text, marginBottom: 4 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  h1: { fontSize: 26, fontFamily: 'Sora_800ExtraBold', letterSpacing: -0.5, color: colors.text },
  muted: { color: colors.textSecondary, marginTop: 2, lineHeight: 19, fontSize: 13 },
  appName: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  tagline: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
    fontSize: 15,
    color: colors.text,
    backgroundColor: '#FDFCF6',
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  buttonText: { color: colors.onPrimary, fontWeight: '800', fontSize: 15 },
  buttonGhost: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonGhostText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  errorText: { color: colors.danger, marginTop: 8, fontSize: 13 },
  link: { color: colors.primary, fontWeight: '700' },
});
