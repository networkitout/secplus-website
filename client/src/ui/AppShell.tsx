import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { api } from '../api/client';
import type { DashboardSummary } from '../api/types';
import { useAuth } from '../features/auth/AuthProvider';
import { RewardsBanner } from '../features/rewards/RewardsProvider';
import { Footer } from './Footer';
import { useRouteChange } from './routeChange';
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
  `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-accent text-on-accent font-semibold' : 'text-text hover:bg-border'}`;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const stats = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardSummary>('dashboard') });
  const items = user?.role === 'admin' ? [...NAV, { to: '/admin', label: 'Admin' }] : NAV;
  const [signOutError, setSignOutError] = useState('');
  const announcement = useRouteChange();

  async function signOut() {
    setSignOutError('');
    try {
      await logout();
    } catch {
      setSignOutError("Couldn't sign out. Try again.");
    }
  }

  return (
    // The padding is the room a celebration takes at the bottom of the window while one is showing, so
    // that the end of the page can be scrolled clear of it (see `RewardsBanner`).
    <div className="flex min-h-screen flex-col bg-bg pb-[var(--celebration-space,0px)] text-text">
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
          {/* `min-w-0`: this row may be narrower than what is in it, so a long name wraps instead of widening the page. */}
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-3">
            {stats.data && (
              <p className="font-mono text-sm">
                <span className="sr-only">Your progress: </span>
                <span>{stats.data.xp} XP</span> · <span>Level {stats.data.level}</span> ·{' '}
                <span>{stats.data.streak}-day streak</span>
              </p>
            )}
            <SaveIndicator />
            <ThemeToggle />
            {user && (
              <>
                <NavLink to="/settings" className={(state) => `${linkClass(state)} min-w-0 max-w-full [overflow-wrap:anywhere]`}>
                  {user.name}
                </NavLink>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent"
                >
                  Sign out
                </button>
              </>
            )}
            {signOutError && (
              <p role="alert" className="basis-full text-right text-sm text-bad">
                {signOutError}
              </p>
            )}
          </div>
        </div>
      </header>
      <RewardsBanner />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
      <Footer />
      {/* Says the name of a page that was navigated to. It is here before it has anything to say: a region
          that arrives together with its text is not announced by every screen reader. */}
      <p id="route-announcer" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
