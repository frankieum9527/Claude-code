import { StyleSheet } from 'react-native';

export const colors = {
  background: '#F4F6F7',
  text: '#1F2933',
  textSecondary: '#52606D',
  muted: '#7B8794',
  card: '#FFFFFF',
  primary: '#2471A3',
  danger: '#C0392B',
};

export const shared = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 20, paddingTop: 72 },
  appName: { fontSize: 14, fontWeight: '600', color: colors.muted, letterSpacing: 1 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 4 },
  muted: { color: colors.muted, marginTop: 2, lineHeight: 19 },
  input: {
    borderWidth: 1,
    borderColor: '#CBD2D9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.card,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 16 },
  errorText: { color: colors.danger, marginTop: 8 },
});
