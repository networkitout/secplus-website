import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { matchPath, useLocation, useNavigationType } from 'react-router';

const SITE_NAME = 'Security+ Trainer';

/**
 * The name of the page at each route of `routes.tsx`, by the route's full path. It is what the browser tab
 * and a screen reader say for the page as soon as the address changes, so it does not depend on anything
 * the page loads (a page may give itself a better title once it has its data: see `usePageTitle`).
 * A test fails when a route has no name here.
 */
export const PAGE_NAMES: Record<string, string> = {
  '/login': 'Sign in',
  '/invite/:token': 'Create your account',
  '/reset/:token': 'Reset your password',
  '/': 'Study path',
  '/lesson/:objective': 'Lesson',
  '/quiz/:id': 'Quiz',
  '/exam': 'Practice exam',
  '/exam/:id': 'Exam',
  '/review': 'Review',
  '/labs': 'Labs',
  '/labs/:id': 'Lab',
  '/dashboard': 'Dashboard',
  '/practice/:objective': 'Practice',
  '/leaderboard': 'Leaderboard',
  '/settings': 'Settings',
  '/admin': 'Admin',
};

/** The name of the page at this path; undefined for a path that is no page of the app. */
export function pageName(pathname: string): string | undefined {
  return Object.entries(PAGE_NAMES).find(([pattern]) => matchPath(pattern, pathname))?.[1];
}

const titleOf = (name: string | undefined) => (name ? `${name} · ${SITE_NAME}` : SITE_NAME);

/**
 * Titles the document after the page that calls it: "<name> · Security+ Trainer". For the pages outside
 * the app shell, and for a page inside it that knows a better name than its route's once its data is
 * there ("Lesson 1.2: …"). Nothing is put back when the page goes: the next page sets its own title.
 *
 * It runs after the shell has set the route's name (`useRouteChange` does that in a layout effect, and
 * those all run before the first effect of this kind), so the better name is the one that stays.
 */
export function usePageTitle(name: string | undefined): void {
  useEffect(() => {
    if (name) document.title = titleOf(name);
  }, [name]);
}

/** Focus inside an element with this attribute is that element's own business: a route change leaves it there. */
const KEEPS_FOCUS = '[data-keeps-focus]';

/**
 * What the app shell does when the path changes; call it once, there. Returns the text for a live region
 * that the shell keeps on the page (`aria-live="polite"`, visually hidden).
 *
 * - The document is titled after the route (see `PAGE_NAMES`), on the first load too.
 * - The page starts at the top, unless the learner went Back or Forward: the browser puts those where
 *   they were.
 * - Focus goes to `#main`, without scrolling to it, when the navigation has left it nowhere (the control
 *   that was pressed went with its page) or on the page frame (a header link). A page that has put focus
 *   somewhere of its own keeps it: its effects run before this one, which belongs to a parent.
 * - The page's name is announced, unless the page has taken focus itself: what it focused is read out.
 *
 * The first load is none of this but the title: nothing was navigated, and focus is the browser's. The
 * shell also appears later than that (after a sign-in, or when another account takes over), always by a
 * redirect: that is a change of page like any other.
 */
export function useRouteChange(): string {
  const { pathname } = useLocation();
  const how = useNavigationType();
  // The path that was dealt with last, and whether its focus and announcement are still to come.
  const seen = useRef<string | null>(null);
  const arriving = useRef(false);
  const [announced, setAnnounced] = useState({ name: '', again: false });

  // Before the page is painted, and before any page's `usePageTitle`.
  useLayoutEffect(() => {
    document.title = titleOf(pageName(pathname));
    const before = seen.current;
    seen.current = pathname;
    // The same path again is an effect that React ran twice (strict mode), not a navigation.
    if (before === pathname || (before === null && how === 'POP')) return;
    arriving.current = true;
    if (how !== 'POP') window.scrollTo(0, 0);
    // Only a change of path is a change of page: `how` is read as it was when the path changed.
  }, [pathname]);

  // After the effects of the page itself.
  useEffect(() => {
    if (!arriving.current) return;
    arriving.current = false;
    const main = document.getElementById('main');
    const active = document.activeElement;
    if (main && active && active !== main && main.contains(active)) return;
    if (!active?.closest(KEEPS_FOCUS)) main?.focus({ preventScroll: true });
    // A second page of the same name ("Lab" after "Lab") is said again only if the region's text changes.
    setAnnounced((last) => ({ name: pageName(pathname) ?? '', again: last.name === pageName(pathname) && !last.again }));
  }, [pathname]);

  return announced.again ? `${announced.name}\u00A0` : announced.name;
}
