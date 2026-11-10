export type Theme = 'dark' | 'light';

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
}
