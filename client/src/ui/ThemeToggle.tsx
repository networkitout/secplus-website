import { useState } from 'react';
import { saveTheme, storedTheme, type Theme } from './theme';

function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' || attr === 'dark' ? attr : storedTheme();
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => {
        saveTheme(next);
        setTheme(next);
      }}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-text hover:border-accent"
    >
      Switch to {next} theme
    </button>
  );
}
