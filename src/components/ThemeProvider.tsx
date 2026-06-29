import { createContext, useContext, useState, useEffect, useCallback, FC, ReactNode } from 'react';
import { ThemeMode, ResolvedTheme, getThemeMode, setThemeMode as persistTheme, resolveTheme } from '../lib/theme';

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  resolved: 'dark',
  setMode: () => {},
});

export const useTheme = () => useContext(ThemeContext);

const META_COLOR: Record<ResolvedTheme, string> = { dark: '#0a0a0a', light: '#ffffff' };

export const ThemeProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(getThemeMode);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(getThemeMode()));

  const setMode = useCallback((m: ThemeMode) => {
    persistTheme(m);
    setModeState(m);
    setResolved(resolveTheme(m));
  }, []);

  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setResolved(resolveTheme('system'));
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', META_COLOR[resolved]);
  }, [resolved]);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
};
