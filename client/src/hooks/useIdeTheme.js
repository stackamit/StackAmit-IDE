import { useEffect } from 'react';
import { useIdeStore } from '../store/ideStore.js';
import { themeMeta } from '../monaco/themes.js';

/**
 * Bridges the store's `themeId` to the Tailwind UI theme: keeps the <html>
 * `dark` class in sync so `dark:` variants follow the selected editor theme.
 * Theme selection itself lives in the store (persisted) and the Settings view.
 */
export function useIdeTheme() {
  const themeId = useIdeStore((s) => s.themeId);
  const setThemeId = useIdeStore((s) => s.setThemeId);
  const cycleTheme = useIdeStore((s) => s.cycleTheme);
  const isDark = themeMeta(themeId).ui === 'dark';

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [isDark]);

  return { themeId, setThemeId, cycleTheme, isDark };
}

export default useIdeTheme;
