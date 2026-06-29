export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const THEME_KEY = 'lemma_theme';

export function getThemeMode(): ThemeMode {
  const raw = localStorage.getItem(THEME_KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'system';
}

export function setThemeMode(mode: ThemeMode): void {
  localStorage.setItem(THEME_KEY, mode);
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const THEME_ORDER: ThemeMode[] = ['system', 'light', 'dark'];
export const THEME_LABELS: Record<ThemeMode, string> = {
  system: '◐ АВТО',
  light: '☀ СВЕТЛАЯ',
  dark: '☾ ТЁМНАЯ',
};
