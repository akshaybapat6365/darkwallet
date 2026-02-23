import React from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

type ThemeContextValue = {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
};

const storageKey = 'darkwallet.theme';
const mediaQuery = '(prefers-color-scheme: dark)';

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const getSystemTheme = (): ResolvedTheme => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia(mediaQuery).matches ? 'dark' : 'light';
};

const resolveTheme = (theme: ThemeMode): ResolvedTheme => {
  if (theme === 'system') return getSystemTheme();
  return theme;
};

const applyThemeClass = (resolvedTheme: ResolvedTheme) => {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolvedTheme);
};

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setThemeState] = React.useState<ThemeMode>(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    return 'system';
  });

  const resolvedTheme = React.useMemo(() => resolveTheme(theme), [theme]);

  React.useEffect(() => {
    applyThemeClass(resolvedTheme);
  }, [resolvedTheme]);

  React.useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(mediaQuery);
    const listener = () => {
      applyThemeClass(resolveTheme('system'));
    };
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, [theme]);

  const setTheme = React.useCallback((next: ThemeMode) => {
    setThemeState(next);
    localStorage.setItem(storageKey, next);
  }, []);

  const toggleTheme = React.useCallback(() => {
    const next = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }, [resolvedTheme, setTheme]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
    }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};

