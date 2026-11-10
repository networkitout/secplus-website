import { useSyncExternalStore } from 'react';
import { currentTheme, onThemeChange, saveTheme, type Theme } from './theme';

/** The theme on the page, kept up to date when any control changes it. */
export function useTheme(): Theme {
  return useSyncExternalStore(onThemeChange, currentTheme);
}

export function ThemeToggle() {
  const theme = useTheme();
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => saveTheme(next)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-text hover:border-accent"
    >
      Switch to {next} theme
    </button>
  );
}
