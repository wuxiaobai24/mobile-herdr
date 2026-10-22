import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { applyTheme, defaultAppearance, getTheme, parseAppearance, type Appearance, type ThemeColors } from '../shared/themes';
import { loadDraft, saveDraft } from './storage';
export const mono = Platform.select({ web: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', ios: 'Menlo', default: 'monospace' });
function makeStyles(colors: ThemeColors, appearance: Appearance) { return StyleSheet.create({
  text: { color: colors.text, fontSize: appearance.readingSize, lineHeight: Math.round(appearance.readingSize * 1.6), fontFamily: appearance.readingFont === 'mono' ? mono : undefined },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  mono: { fontFamily: mono },
  row: { flexDirection: 'row', alignItems: 'center' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, minHeight: 44, paddingHorizontal: 14, backgroundColor: colors.accent },
  buttonText: { fontSize: 14, fontWeight: '600', color: colors.accentInk },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  field: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, color: colors.text, padding: 13, fontSize: 16, backgroundColor: colors.bg },
  label: { color: colors.muted, fontSize: 13, marginBottom: 7 },
}); }

const ThemeContext = createContext<ReturnType<typeof useAppearanceState> | null>(null);
function useAppearanceState() {
  const [appearance, setAppearance] = useState(defaultAppearance);
  const [ready, setReady] = useState(false);
  const [appearanceError, setAppearanceError] = useState('');
  useEffect(() => {
    let active = true;
    void loadDraft('appearance').then(value => {
      if (!active) return;
      try { if (value) setAppearance(parseAppearance(JSON.parse(value))); }
      catch { setAppearanceError('外观设置无法读取，已使用默认主题。'); }
      setReady(true);
    }).catch(() => { if (active) { setAppearanceError('外观设置无法读取。'); setReady(true); } });
    return () => { active = false; };
  }, []);
  const theme = getTheme(appearance.theme);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    applyTheme(document.documentElement, theme);
    const browserColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (browserColor) browserColor.content = theme.colors.bg;
    document.documentElement.style.setProperty('--reading-size', `${appearance.readingSize}px`);
    document.documentElement.style.setProperty('--reading-font', appearance.readingFont === 'mono' ? mono! : 'inherit');
  }, [theme, appearance.readingSize, appearance.readingFont]);
  async function updateAppearance(patch: Partial<Appearance>): Promise<void> {
    const next = parseAppearance({ ...appearance, ...patch });
    setAppearance(next);
    try { await saveDraft('appearance', JSON.stringify(next)); setAppearanceError(''); }
    catch { setAppearanceError('设置未能保存，刷新后可能恢复。'); }
  }
  const styles = useMemo(() => makeStyles(theme.colors, appearance), [theme, appearance]);
  return { appearance, updateAppearance, appearanceError, ready, theme, colors: theme.colors, styles };
}
export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const value = useAppearanceState();
  return createElement(ThemeContext.Provider, { value }, children);
}
export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('ThemeProvider is required.');
  return value;
}
