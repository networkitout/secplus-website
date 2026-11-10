import { saveTheme, useTheme, type Theme } from './theme';

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
