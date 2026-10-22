// Palettes: https://github.com/catppuccin/palette and https://github.com/kepano/flexoki.
// See docs/theme-credits.md for attribution and licenses.
export interface ThemeColors {
  bg: string; sidebar: string; surface: string; hover: string; line: string;
  text: string; muted: string; dim: string; accent: string; accentInk: string;
  amber: string; red: string; blue: string; success: string; magenta: string; cyan: string;
  accentSurface: string; warningSurface: string; errorSurface: string; overlay: string;
}
export interface Theme { id: string; name: string; detail: string; dark: boolean; colors: ThemeColors }
function mix(base: string, color: string, amount: number): string {
  const channel = (offset: number) => Math.round(parseInt(base.slice(offset, offset + 2), 16) * (1 - amount) + parseInt(color.slice(offset, offset + 2), 16) * amount).toString(16).padStart(2, '0');
  return '#' + channel(1) + channel(3) + channel(5);
}
function palette(input: Omit<ThemeColors, 'accentSurface' | 'warningSurface' | 'errorSurface' | 'overlay'>): ThemeColors {
  return { ...input, accentSurface: mix(input.bg, input.accent, .12), warningSurface: mix(input.bg, input.amber, .09), errorSurface: mix(input.bg, input.red, .1), overlay: '#09090ba8' };
}
const catppuccin = {
  "mocha": {
    "mauve": "#cba6f7",
    "red": "#f38ba8",
    "yellow": "#f9e2af",
    "green": "#a6e3a1",
    "teal": "#94e2d5",
    "sapphire": "#74c7ec",
    "blue": "#89b4fa",
    "text": "#cdd6f4",
    "subtext1": "#bac2de",
    "subtext0": "#a6adc8",
    "surface1": "#45475a",
    "surface0": "#313244",
    "base": "#1e1e2e",
    "mantle": "#181825",
    "crust": "#11111b"
  },
  "macchiato": {
    "mauve": "#c6a0f6",
    "red": "#ed8796",
    "yellow": "#eed49f",
    "green": "#a6da95",
    "teal": "#8bd5ca",
    "sapphire": "#7dc4e4",
    "blue": "#8aadf4",
    "text": "#cad3f5",
    "subtext1": "#b8c0e0",
    "subtext0": "#a5adcb",
    "surface1": "#494d64",
    "surface0": "#363a4f",
    "base": "#24273a",
    "mantle": "#1e2030",
    "crust": "#181926"
  },
  "frappe": {
    "mauve": "#ca9ee6",
    "red": "#e78284",
    "yellow": "#e5c890",
    "green": "#a6d189",
    "teal": "#81c8be",
    "sapphire": "#85c1dc",
    "blue": "#8caaee",
    "text": "#c6d0f5",
    "subtext1": "#b5bfe2",
    "subtext0": "#a5adce",
    "surface1": "#51576d",
    "surface0": "#414559",
    "base": "#303446",
    "mantle": "#292c3c",
    "crust": "#232634"
  },
  "latte": {
    "mauve": "#8839ef",
    "red": "#d20f39",
    "yellow": "#df8e1d",
    "green": "#40a02b",
    "teal": "#179299",
    "sapphire": "#209fb5",
    "blue": "#1e66f5",
    "text": "#4c4f69",
    "subtext1": "#5c5f77",
    "subtext0": "#6c6f85",
    "surface1": "#bcc0cc",
    "surface0": "#ccd0da",
    "base": "#eff1f5",
    "mantle": "#e6e9ef",
    "crust": "#dce0e8"
  }
} as const;
function catTheme(id: keyof typeof catppuccin, name: string, detail: string): Theme {
  const c = catppuccin[id];
  return { id, name: `Catppuccin ${name}`, detail, dark: id !== 'latte', colors: palette({
    bg: c.base, sidebar: c.mantle, surface: id === 'latte' ? '#ffffff' : c.surface0, hover: id === 'latte' ? c.surface0 : c.surface1, line: c.surface1,
    text: c.text, muted: c.subtext1, dim: c.subtext0, accent: c.blue, accentInk: id === 'latte' ? '#ffffff' : c.crust,
    amber: id === 'latte' ? '#986515' : c.yellow, red: c.red, blue: c.sapphire, success: id === 'latte' ? '#527d27' : c.green, magenta: c.mauve, cyan: c.teal,
  }) };
}
export const themes: Theme[] = [
  catTheme('mocha', 'Mocha', '深色 · 柔和冷调'),
  catTheme('macchiato', 'Macchiato', '深色 · 蓝灰'),
  catTheme('frappe', 'Frappé', '深色 · 低对比底色'),
  catTheme('latte', 'Latte', '浅色 · 明亮清晰'),
  { id: 'flexoki-dark', name: 'Flexoki Dark', detail: '深色 · 墨色暖灰', dark: true, colors: palette({
    bg: '#100f0f', sidebar: '#1c1b1a', surface: '#282726', hover: '#343331', line: '#403e3c', text: '#cecdc3', muted: '#b7b5ac', dim: '#9f9d96',
    accent: '#4385be', accentInk: '#100f0f', amber: '#d0a215', red: '#d14d41', blue: '#4385be', success: '#879a39', magenta: '#8b7ec8', cyan: '#3aa99f',
  }) },
  { id: 'flexoki-light', name: 'Flexoki Light', detail: '浅色 · 纸张暖白', dark: false, colors: palette({
    bg: '#fffcf0', sidebar: '#f2f0e5', surface: '#fffcf0', hover: '#e6e4d9', line: '#cecdc3', text: '#100f0f', muted: '#575653', dim: '#6f6e69',
    accent: '#205ea6', accentInk: '#fffcf0', amber: '#8d6b00', red: '#af3029', blue: '#205ea6', success: '#536907', magenta: '#5e409d', cyan: '#24837b',
  }) },
];
export interface Appearance { theme: string; readingSize: number; terminalSize: number; readingFont: 'system' | 'mono' }
export const defaultAppearance: Appearance = { theme: 'mocha', readingSize: 16, terminalSize: 13, readingFont: 'system' };
export function parseAppearance(value: unknown): Appearance {
  const a = value && typeof value === 'object' ? value as Partial<Appearance> : {};
  return { theme: themes.some(t => t.id === a.theme) ? a.theme! : defaultAppearance.theme,
    readingSize: [14, 16, 18, 20].includes(a.readingSize!) ? a.readingSize! : 16,
    terminalSize: [11, 13, 15, 17].includes(a.terminalSize!) ? a.terminalSize! : 13,
    readingFont: a.readingFont === 'mono' ? 'mono' : 'system' };
}
export function getTheme(id: string): Theme { return themes.find(theme => theme.id === id) ?? themes[0]; }
export function applyTheme(element: HTMLElement, theme: Theme): void {
  for (const [key, value] of Object.entries(theme.colors)) element.style.setProperty(`--${key}`, value);
  element.style.colorScheme = theme.dark ? 'dark' : 'light';
  element.dataset.theme = theme.id;
}
