import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react';
import {
  createRoutesFromElements,
  Link,
  MemoryRouter,
  Outlet,
  Route,
  Routes,
  useNavigate,
  type NavigateFunction,
  type RouteObject,
} from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api/types';
import { AuthContext, type AuthValue } from '../features/auth/AuthProvider';
import { RewardsProvider } from '../features/rewards/RewardsProvider';
import { createQueryClient } from '../queryClient';
import { AppRoutes } from '../routes';
import { AppShell } from './AppShell';
import { PAGE_NAMES, pageName, usePageTitle } from './routeChange';

const SITE = 'Security+ Trainer';
const admin: User = { id: 1, login: 'root', name: 'Root', role: 'admin', timeZone: 'UTC', examDate: null, hideFromLeaderboard: false };
const auth = (user: User | null): AuthValue => ({ user, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() });

/** Every path that `routes.tsx` can show a page at, as its route pattern ("/lesson/:objective"). */
function routesOfTheApp(): { pattern: string; route: RouteObject }[] {
  let routes!: ReactElement<{ children: ReactNode }>;
  function Probe() {
    routes = AppRoutes() as ReactElement<{ children: ReactNode }>;
    return null;
  }
  render(
    <AuthContext.Provider value={auth(admin)}>
      <Probe />
    </AuthContext.Provider>,
  ).unmount();
  const leaves = (list: RouteObject[], parent: string): { pattern: string; route: RouteObject }[] =>
    list.flatMap((route) => {
      const pattern = route.index || !route.path ? parent : `${parent.replace(/\/$/, '')}/${route.path.replace(/^\//, '')}`;
      return route.children ? leaves(route.children, pattern) : [{ pattern: pattern || '/', route }];
    });
  return leaves(createRoutesFromElements(routes.props.children), '');
}

const urlOf = (pattern: string) => pattern.replace(/:\w+/g, 'x1');
const announcer = () => document.getElementById('route-announcer')!;
/** Lets the effects of a navigation, and the update they cause, finish. */
const settled = () => act(async () => {});
const main = () => screen.getByRole('main');

let scrollTo: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  document.title = SITE;
  // Nothing answers: every page stays in its loading state, which is all a title needs.
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('page names', () => {
  const routes = routesOfTheApp();

  it('every route in routes.tsx has a page name, and every page name belongs to a route', () => {
    // The catch-all shows no page of its own: it only sends the visitor to the study path.
    const catchAll = routes.find((r) => r.pattern === '/*');
    expect((catchAll?.route.element as ReactElement<{ to: string }>).props.to).toBe('/');
    const patterns = routes.filter((r) => r !== catchAll).map((r) => r.pattern);
    expect(patterns.length).toBeGreaterThan(10);
    for (const pattern of patterns) expect(PAGE_NAMES, `no page name for the route ${pattern}`).toHaveProperty([pattern]);
    expect(Object.keys(PAGE_NAMES).sort()).toEqual([...patterns].sort());
    for (const name of Object.values(PAGE_NAMES)) expect(name).not.toBe('');
  });

  it.each(Object.entries(PAGE_NAMES))('%s is titled "%s · Security+ Trainer"', (pattern, name) => {
    expect(pageName(urlOf(pattern))).toBe(name);
    const signedOut = ['/login', '/invite/:token', '/reset/:token'].includes(pattern);
    render(
      <QueryClientProvider client={createQueryClient()}>
        <AuthContext.Provider value={auth(signedOut ? null : admin)}>
          <MemoryRouter initialEntries={[urlOf(pattern)]}>
            <AppRoutes />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
    // A page that knows more at once may say more after the name ("Practice: objective 1.2").
    expect(document.title.startsWith(name)).toBe(true);
    expect(document.title).toMatch(/^[^·]+ · Security\+ Trainer$/);
    if (pattern !== '/practice/:objective') expect(document.title).toBe(`${name} · ${SITE}`);
  });

  it('a path that is no page of the app has no name', () => {
    expect(pageName('/nowhere')).toBeUndefined();
    expect(pageName('/exam/3/more')).toBeUndefined();
  });
});

/** A page that has nothing to focus. `to` gives it a button that goes on to another page and is gone with this one. */
function Plain({ name, to }: { name: string; to?: string }) {
  const navigate = useNavigate();
  return (
    <div>
      <h1>{name}</h1>
      {to && <button onClick={() => void navigate(to)}>Go on</button>}
      <Link to="/lab/b">Another lab</Link>
    </div>
  );
}

/** A page that puts focus on its own heading when it appears, in the effect of that kind. */
function Focusing({ name, effect }: { name: string; effect: typeof useEffect }) {
  const heading = useRef<HTMLHeadingElement>(null);
  effect(() => heading.current?.focus(), []);
  return (
    <h1 ref={heading} tabIndex={-1}>
      {name}
    </h1>
  );
}

/** A page that knows a better title once it is on screen. */
function Titled({ title }: { title: string }) {
  usePageTitle(title);
  return <h1>{title}</h1>;
}

let navigate: NavigateFunction;
function Navigator() {
  navigate = useNavigate();
  return null;
}

function renderShell(entries: string[] = ['/'], index?: number) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ xp: 120, level: 3, nextLevelXp: 200, streak: 4 }), { status: 200 })));
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthContext.Provider value={auth(admin)}>
        <RewardsProvider>
          <MemoryRouter initialEntries={entries} initialIndex={index}>
            <Navigator />
            <Routes>
              <Route
                element={
                  <AppShell>
                    <Outlet />
                  </AppShell>
                }
              >
                <Route index element={<Plain name="Path page" to="/quiz/7" />} />
                <Route path="dashboard" element={<Plain name="Dashboard page" />} />
                <Route path="review" element={<Focusing name="Review page" effect={useEffect} />} />
                <Route path="settings" element={<Focusing name="Settings page" effect={useLayoutEffect} />} />
                <Route path="quiz/:id" element={<Plain name="Quiz page" />} />
                <Route path="labs/:id" element={<Plain name="Lab page" />} />
                <Route path="lesson/:objective" element={<Titled title="Lesson 1.2: Security controls" />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </RewardsProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('a change of route', () => {
  it('on first load the page is titled, and nothing is announced, focused or scrolled', async () => {
    renderShell(['/dashboard']);
    await screen.findByText('120 XP');
    expect(document.title).toBe(`Dashboard · ${SITE}`);
    // The region is on the page before it has anything to say, and it is not the rewards region.
    expect(announcer()).toBeEmptyDOMElement();
    expect(announcer()).toHaveAttribute('aria-live', 'polite');
    expect(announcer()).not.toBe(screen.getByRole('status', { name: 'Rewards' }));
    expect(screen.getByRole('status', { name: 'Rewards' })).not.toContainElement(announcer());
    expect(document.body).toHaveFocus();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('following a header link titles and announces the new page, moves focus to the main region and starts at the top', async () => {
    renderShell(['/']);
    await userEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard page' })).toBeInTheDocument();
    await settled();

    expect(document.title).toBe(`Dashboard · ${SITE}`);
    expect(announcer()).toHaveTextContent(/^Dashboard$/);
    expect(main()).toHaveFocus();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('focus moves to the main region without scrolling the page to it', async () => {
    renderShell(['/']);
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    await userEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
    await screen.findByRole('heading', { name: 'Dashboard page' });
    await settled();
    expect(focus.mock.contexts.at(-1)).toBe(main());
    expect(focus.mock.calls.at(-1)).toEqual([{ preventScroll: true }]);
  });

  it('when the control that was pressed is gone with its page, focus goes to the main region instead of the document', async () => {
    renderShell(['/']);
    await userEvent.click(screen.getByRole('button', { name: 'Go on' }));
    expect(await screen.findByRole('heading', { name: 'Quiz page' })).toBeInTheDocument();
    await settled();
    expect(main()).toHaveFocus();
    expect(document.title).toBe(`Quiz · ${SITE}`);
    expect(announcer()).toHaveTextContent(/^Quiz$/);
  });

  it.each([
    ['Review', 'an effect'],
    ['Root', 'a layout effect'],
  ])('a page that puts focus on its own heading keeps it, and is not announced a second time (%s: focused in %s)', async (link) => {
    renderShell(['/']);
    await userEvent.click(screen.getByRole('link', { name: link }));
    const heading = await screen.findByRole('heading', { level: 1 });
    await settled();
    expect(heading).toHaveFocus();
    expect(document.title).toBe(`${link === 'Review' ? 'Review' : 'Settings'} · ${SITE}`);
    // The heading is read out when it takes focus: the page name would be said twice.
    expect(announcer()).toBeEmptyDOMElement();
  });

  it('focus that the learner has put in the rewards banner stays there', async () => {
    renderShell(['/']);
    const banner = screen.getByRole('status', { name: 'Rewards' }).parentElement!;
    act(() => banner.focus());
    await act(() => navigate('/dashboard'));
    expect(await screen.findByRole('heading', { name: 'Dashboard page' })).toBeInTheDocument();
    await settled();
    expect(banner).toHaveFocus();
    expect(announcer()).toHaveTextContent(/^Dashboard$/);
  });

  it('two pages in a row with the same name are each announced', async () => {
    renderShell(['/labs/a']);
    await act(() => navigate('/labs/b'));
    const first = announcer().textContent;
    expect(announcer()).toHaveTextContent(/^Lab$/);
    await act(() => navigate('/labs/c'));
    expect(announcer()).toHaveTextContent(/^Lab$/);
    // The text of the region has to change for it to be read again.
    expect(announcer().textContent).not.toBe(first);
  });

  it('scrolls to the top on a new page and on a redirect, and leaves Back and Forward to the browser', async () => {
    renderShell(['/', '/dashboard'], 1);
    await act(() => navigate('/quiz/7'));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await act(() => navigate('/labs/a', { replace: true }));
    expect(scrollTo).toHaveBeenCalledTimes(2);

    await act(() => navigate(-1));
    expect(await screen.findByRole('heading', { name: 'Dashboard page' })).toBeInTheDocument();
    await act(() => navigate(1));
    expect(await screen.findByRole('heading', { name: 'Lab page' })).toBeInTheDocument();
    await settled();
    expect(scrollTo).toHaveBeenCalledTimes(2);
    // Back and Forward are still new pages to a screen reader, and to the keyboard.
    expect(announcer()).toHaveTextContent(/^Lab$/);
    expect(document.title).toBe(`Lab · ${SITE}`);
    expect(main()).toHaveFocus();
  });

  it('a page may give itself a better title, and the next page sets its own', async () => {
    renderShell(['/']);
    await act(() => navigate('/lesson/1.2'));
    expect(await screen.findByRole('heading', { name: 'Lesson 1.2: Security controls' })).toBeInTheDocument();
    await settled();
    expect(document.title).toBe(`Lesson 1.2: Security controls · ${SITE}`);
    // What is announced is the name of the route: it is known at once, the better title only with the data.
    expect(announcer()).toHaveTextContent(/^Lesson$/);

    await userEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
    await screen.findByRole('heading', { name: 'Dashboard page' });
    expect(document.title).toBe(`Dashboard · ${SITE}`);
  });

  it('the same page with another query or hash is not a new page', async () => {
    renderShell(['/dashboard']);
    await act(() => navigate('/dashboard?tab=2'));
    await act(() => navigate('/dashboard#badges'));
    await settled();
    expect(announcer()).toBeEmptyDOMElement();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.body).toHaveFocus();
  });
});
