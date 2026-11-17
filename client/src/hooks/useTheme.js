import { useCallback, useEffect, useState } from 'react';

const KEY = 'stackamit:theme';

/**
 * Theme management persisted as a raw string so the pre-paint inline script in
 * index.html can read it without JSON parsing (avoids a flash of wrong theme).
 */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const stored = window.localStorage.getItem(KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      /* ignore */
    }
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      window.localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, setTheme, toggleTheme, isDark: theme === 'dark' };
}

export default useTheme;
