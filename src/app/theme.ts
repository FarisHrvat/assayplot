import { useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'assayplot.theme';
const isTheme = (value: unknown): value is Theme =>
  value === 'light' || value === 'dark' || value === 'system';

// localStorage throws outright in a private window or with site data blocked,
// so both accesses go through here. Forgetting the preference is survivable.
function remember(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* not remembered */
  }
}

function recall(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return isTheme(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Follows the operating system unless the user chooses otherwise. The choice is
 * a stamp on the root element; the palette lives in styles.css, so nothing here
 * knows what any colour is.
 */
export function useTheme(): [Theme, (next: Theme) => void, 'light' | 'dark'] {
  const [theme, setTheme] = useState<Theme>(recall);
  const [systemIsDark, setSystemIsDark] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    remember(theme);
  }, [theme]);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemIsDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return [theme, setTheme, theme === 'system' ? (systemIsDark ? 'dark' : 'light') : theme];
}
