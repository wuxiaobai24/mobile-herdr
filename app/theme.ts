import { Platform, StyleSheet } from 'react-native';
export const colors = {
  bg: '#101415', sidebar: '#141a1b', surface: '#1b2223', hover: '#222c2c', line: '#2a3434',
  text: '#edf2ef', muted: '#a6b4af', dim: '#84958d', accent: '#b8edcf', accentInk: '#122a20',
  amber: '#f4ce8a', red: '#f5a6a0', blue: '#a9c9ef',
};
export const mono = Platform.select({ web: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', ios: 'Menlo', default: 'monospace' });
export const styles = StyleSheet.create({
  text: { color: colors.text, fontSize: 15, lineHeight: 24 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  mono: { fontFamily: mono },
  row: { flexDirection: 'row', alignItems: 'center' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, minHeight: 44, paddingHorizontal: 14, backgroundColor: colors.accent },
  buttonText: { fontSize: 14, fontWeight: '600', color: colors.accentInk },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  field: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, color: colors.text, padding: 13, fontSize: 16, backgroundColor: colors.bg },
  label: { color: colors.muted, fontSize: 13, marginBottom: 7 },
});
