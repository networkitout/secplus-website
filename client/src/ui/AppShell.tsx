import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { api } from '../api/client';
import type { DashboardSummary } from '../api/types';
import { useAuth } from '../features/auth/AuthProvider';
import { SaveIndicator } from './SaveIndicator';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { to: '/', label: 'Path', end: true },
  { to: '/review', label: 'Review' },
  { to: '/labs', label: 'Labs' },
  { to: '/exam', label: 'Exam' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/leaderboard', label: 'Leaderboard' },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-accent text-on-accent font-semibold' : 'text-text hover:bg-surface'}`;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const stats = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardSummary>('dashboard') });
  const items = user?.role === 'admin' ? [...NAV, { to: '/admin', label: 'Admin' }] : NAV;

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold text-accent">SecPlus Trainer</span>
          <nav aria-label="Main" className="flex flex-wrap gap-1">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={linkClass}>
                {i.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {stats.data && (
              <p className="font-mono text-sm" aria-label="Progress">
                <span>{stats.data.xp} XP</span> · <span>Level {stats.data.level}</span> ·{' '}
                <span>{stats.data.streak}-day streak</span>
              </p>
            )}
            <SaveIndicator />
            <ThemeToggle />
            {user && (
              <>
                <NavLink to="/settings" className={linkClass}>
                  {user.name}
                </NavLink>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent"
                >
                  Sign out
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
      <footer className="border-t border-border px-4 py-4 text-center text-xs text-muted">
        Not affiliated with or endorsed by CompTIA. Security+ is a trademark of CompTIA, Inc.
      </footer>
    </div>
  );
}
