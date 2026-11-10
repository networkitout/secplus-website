import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
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

/** The room kept beside a link that is brought into view in the scrolling row, in px: its focus ring fits in it. */
const NAV_PEEK = 8;

/**
 * Scrolls the row of links, and nothing else, so that this link is in view. `scrollIntoView` would also
 * move the window to the header, away from where Back has just put it. On a wide screen nothing overflows,
 * and this does nothing.
 */
function reveal(row: HTMLElement, link: HTMLElement) {
  // The row is the links' offset parent (it is `relative`).
  const start = link.offsetLeft - NAV_PEEK;
  const end = link.offsetLeft + link.offsetWidth + NAV_PEEK;
  if (start < row.scrollLeft) row.scrollLeft = Math.max(0, start);
  else if (end > row.scrollLeft + row.clientWidth) row.scrollLeft = end - row.clientWidth;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const stats = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardSummary>('dashboard') });
  const items = user?.role === 'admin' ? [...NAV, { to: '/admin', label: 'Admin' }] : NAV;
  const [signOutError, setSignOutError] = useState('');
  const announcement = useRouteChange();
  const { pathname } = useLocation();
  const nav = useRef<HTMLElement>(null);

  // Below the `sm` breakpoint the navigation is one row that scrolls sideways: the link of the page that
  // is open is brought into view in it.
  useEffect(() => {
    const current = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav.current && current) reveal(nav.current, current);
  }, [pathname]);

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
      {/* Below the `sm` breakpoint the header is compact, in the order it is read and tabbed through: the
          name of the site, the navigation in one row that scrolls sideways, the progress on one line, and
          the learner's name beside "Sign out". From `sm` on it is the wrapping row it has always been. */}
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1.5 px-4 py-2 sm:gap-y-2 sm:py-3">
          <span className="font-semibold text-accent">SecPlus Trainer</span>
          {/* The row is 4px larger than its line on every side, and the margin takes that back: the focus
              ring of a link at its edge is inside the scrolling box, which would cut it off otherwise.
              `relative`: the links are placed against the row, which is how the current one is found. */}
          <nav
            ref={nav}
            aria-label="Main"
            // So is a link that takes keyboard focus: a browser leaves one that is partly in view where it
            // is, with its focus ring cut off.
            onFocus={(e) => reveal(e.currentTarget, e.target)}
            className="relative -m-1 flex shrink-0 basis-[calc(100%+0.5rem)] flex-nowrap gap-1 overflow-x-auto p-1 [scrollbar-width:thin] sm:m-0 sm:shrink sm:basis-auto sm:flex-wrap sm:overflow-visible sm:p-0"
          >
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={(state) => `${linkClass(state)} shrink-0`}>
                {i.label}
              </NavLink>
            ))}
          </nav>
          {/* `min-w-0`: this row may be narrower than what is in it, so a long name wraps instead of widening the page. */}
          <div className="flex min-w-0 basis-full flex-wrap items-center gap-x-3 gap-y-1.5 sm:ml-auto sm:basis-auto sm:gap-3">
            {stats.data && (
              <p className="whitespace-nowrap font-mono text-sm">
                <span className="sr-only">Your progress: </span>
                <span>{stats.data.xp} XP</span> · <span>Level {stats.data.level}</span> ·{' '}
                <span>{stats.data.streak}-day streak</span>
              </p>
            )}
            <SaveIndicator />
            {/* On a phone the Settings page has the theme control. */}
            <ThemeToggle className="hidden sm:inline-block" />
            {user && (
              // On a phone: a line of its own, the name cut to what fits beside "Sign out" (the link's
              // text is the whole name all the same). From `sm` the two are items of the row above.
              <div className="flex min-w-0 basis-full items-center justify-between gap-3 sm:contents">
                <NavLink
                  to="/settings"
                  className={(state) =>
                    `${linkClass(state)} min-w-0 max-w-full truncate [overflow-wrap:anywhere] sm:overflow-visible sm:whitespace-normal`
                  }
                >
                  {user.name}
                </NavLink>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent"
                >
                  Sign out
                </button>
              </div>
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
