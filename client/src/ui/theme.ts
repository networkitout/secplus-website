import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

const listeners = new Set<() => void>();

export function storedTheme(): Theme {
  try {
    const t = localStorage.getItem('theme');
    if (t === 'dark' || t === 'light') return t;
  } catch {
    /* storage unavailable: fall through to the system preference */
  }
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

/** The theme that the page shows now. */
export function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' || attr === 'dark' ? attr : storedTheme();
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function saveTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem('theme', theme);
  } catch {
    /* the choice just won't persist */
  }
  for (const listener of listeners) listener();
}

/** Calls `listener` after every `saveTheme`, so that each theme control shows the same choice. Returns the unsubscribe function. */
export function onThemeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The theme on the page, kept up to date when any control changes it. */
export function useTheme(): Theme {
  return useSyncExternalStore(onThemeChange, currentTheme);
}
