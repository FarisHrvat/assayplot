import { useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'assayplot.theme';

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // Private windows and locked-down browsers refuse localStorage entirely.
  }
  return 'system';
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/**
 * Follows the operating system unless the user has chosen otherwise. The choice
 * is a stamp on the root element; the palette itself lives in styles.css, so
 * nothing here knows what any colour is.
 */
export function useTheme(): [Theme, (next: Theme) => void, 'light' | 'dark'] {
  const [theme, setTheme] = useState<Theme>(stored);
  const [systemIsDark, setSystemIsDark] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    apply(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Not being able to remember the choice is survivable.
    }
  }, [theme]);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemIsDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved = theme === 'system' ? (systemIsDark ? 'dark' : 'light') : theme;
  return [theme, setTheme, resolved];
}
