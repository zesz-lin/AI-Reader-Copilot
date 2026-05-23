import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'ai-reader-theme';

function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch { /* */ }
      return next;
    });
  }, []);

  return { theme, toggle };
}
