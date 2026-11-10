import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { saveQueue } from '../../api/saveQueue';
import type { DashboardResponse, User } from '../../api/types';
import { createQueryClient } from '../../queryClient';
import { AppRoutes } from '../../routes';
import { AuthContext, AuthProvider, RequireAdmin, type AuthValue } from './AuthProvider';
import { safeNext } from './LoginPage';

const FOOTER = 'Not affiliated with or endorsed by CompTIA. Security+ is a trademark of CompTIA, Inc.';
const learner: User = { id: 2, login: 'sam', name: 'Sam', role: 'learner', timeZone: 'UTC', examDate: null, hideFromLeaderboard: false };
const admin: User = { ...learner, id: 1, login: 'root', name: 'Root', role: 'admin' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handlers: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  handlers = {
    'GET /api/auth/me': () => json(401, { error: 'Not signed in' }),
    'GET /api/dashboard': () =>
      json(200, {
        xp: 0, level: 1, nextLevelXp: 100, streak: 0, reviewsDue: 0, domains: [], weakest: [], mockHistory: [],
        readiness: { ready: false, missing: [] }, studyPlan: null, badges: [],
      }),
    'GET /api/admin/users': () => json(200, { users: [] }),
    'GET /api/path': () => json(200, { domains: [] }),
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const h = handlers[key];
    if (!h) throw new Error(`unexpected request ${key}`);
    return h(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string, client: QueryClient = createQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** What the dashboard answers for a learner with this much XP. */
const totals = (xp: number, level: number): DashboardResponse => ({
  xp, level, nextLevelXp: 99_999, streak: 0, reviewsDue: 0, domains: [], weakest: [], mockHistory: [],
  readiness: { ready: false, missing: [] }, studyPlan: null, badges: [],
  openMock: null, mockSpec: { questions: 11, minutes: 11, partial: true },
});

async function signIn(name: string) {
  await userEvent.type(await screen.findByLabelText('Login name'), name);
  await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

const postBody = (key: string) => JSON.parse(String(fetchMock.mock.calls.find(([u, i]) => `${i?.method ?? 'GET'} ${u}` === key)![1].body));

describe('login form', () => {
  it('redirects a signed-out visitor to /login', async () => {
    renderAt('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('No account? Ask the site owner for an invite link.')).toBeInTheDocument();
  });

  it('shows the CompTIA footer while the session is still loading', () => {
    handlers['GET /api/auth/me'] = () => new Promise<Response>(() => {});
    renderAt('/dashboard');
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.getByText(FOOTER)).toBeInTheDocument();
  });

  it('shows the CompTIA footer', async () => {
    renderAt('/login');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.getByText(FOOTER)).toBeInTheDocument();
  });

  it('submit calls api, on success navigates to next', async () => {
    handlers['POST /api/auth/login'] = () => json(200, { user: learner });
    renderAt('/login?next=%2Fdashboard');
    await userEvent.type(await screen.findByLabelText('Login name'), 'sam');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(postBody('POST /api/auth/login')).toEqual({ login: 'sam', password: 'correct horse battery' });
  });

  it('on 401 shows "Invalid login or password"', async () => {
    handlers['POST /api/auth/login'] = () => json(401, { error: 'Invalid login or password' });
    renderAt('/login');
    await userEvent.type(await screen.findByLabelText('Login name'), 'sam');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login or password');
  });

  it('on 429 shows a wait message', async () => {
    handlers['POST /api/auth/login'] = () => json(429, { error: 'Too many attempts. Try again later.' });
    renderAt('/login');
    await userEvent.type(await screen.findByLabelText('Login name'), 'sam');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Wait a few minutes and try again.');
  });

  it('ignores an off-site next target', async () => {
    handlers['POST /api/auth/login'] = () => json(200, { user: learner });
    renderAt('/login?next=%2F%2Fevil.example');
    await userEvent.type(await screen.findByLabelText('Login name'), 'sam');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Study path' })).toBeInTheDocument();
  });

  it('ignores a next target that only resolves off-site once the browser strips a tab', async () => {
    handlers['POST /api/auth/login'] = () => json(200, { user: learner });
    renderAt('/login?next=%2F%09%2Fevil.example');
    await userEvent.type(await screen.findByLabelText('Login name'), 'sam');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Study path' })).toBeInTheDocument();
  });
});

describe('safeNext', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/lesson/1.1?tab=quiz#summary', '/lesson/1.1?tab=quiz#summary'],
  ])('keeps the same-site path %j', (raw, expected) => {
    expect(safeNext(raw)).toBe(expected);
  });

  it.each([
    null,
    '',
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/.//evil.example',
    '/..//evil.example',
    'https://evil.example/path',
    'javascript:alert(1)',
    `blob:${window.location.origin}/dashboard`,
  ])('falls back to / for %j', (raw) => {
    expect(safeNext(raw)).toBe('/');
  });
});

describe('sign out', () => {
  beforeEach(() => {
    handlers['GET /api/auth/me'] = () => json(200, { user: learner });
  });

  it('signs the user out and returns to the login page', async () => {
    handlers['POST /api/auth/logout'] = () => json(200, { ok: true });
    renderAt('/dashboard');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('keeps the user signed in and says so when the request fails', async () => {
    handlers['POST /api/auth/logout'] = () => json(500, { error: 'Internal error' });
    renderAt('/dashboard');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't sign out. Try again.");
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sam' })).toBeInTheDocument();
  });
});

describe('a change of account on the same page', () => {
  const other: User = { ...learner, id: 3, login: 'kim', name: 'Kim' };

  beforeEach(() => {
    handlers['GET /api/auth/me'] = () => json(200, { user: learner });
  });

  it('after a session ends with a 401 and another learner signs in, nothing of the earlier account is shown and no level-up is celebrated', async () => {
    handlers['GET /api/dashboard'] = () => json(200, totals(120, 2));
    renderAt('/dashboard');
    expect(await screen.findByText('120 XP')).toBeInTheDocument();

    // The session has ended on the server (it expired, or the account was deactivated): the next request is refused.
    handlers['GET /api/path'] = () => json(401, { error: 'Not signed in' });
    await userEvent.click(screen.getByRole('link', { name: 'Path' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    // Another learner signs in. Their own numbers are slow to arrive, and they are on a higher level.
    let arrive!: (r: Response) => void;
    handlers['POST /api/auth/login'] = () => json(200, { user: other });
    handlers['GET /api/path'] = () => json(200, { domains: [] });
    handlers['GET /api/dashboard'] = () => new Promise<Response>((resolve) => (arrive = resolve));
    await signIn('kim');
    expect(await screen.findByRole('heading', { name: 'Study path' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kim' })).toBeInTheDocument();
    expect(screen.queryByText('120 XP')).not.toBeInTheDocument();
    expect(screen.queryByText('Level 2')).not.toBeInTheDocument();

    await act(async () => arrive(json(200, totals(5000, 7))));
    expect(await screen.findByText('5000 XP')).toBeInTheDocument();
    expect(screen.getByText('Level 7')).toBeInTheDocument();
    // Level 7 is where this learner starts, not a step up from the level of the one before.
    expect(screen.queryByText('Level up')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Rewards' })).toBeEmptyDOMElement();
  });

  it('a notice about a dropped save does not outlive the account it was for: it goes on sign-out and on sign-in', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    handlers['POST /api/auth/logout'] = () => json(200, { ok: true });
    renderAt('/dashboard');
    await screen.findByRole('button', { name: 'Sign out' });
    act(() => saveQueue.enqueue('answer', () => Promise.reject(new ApiError(400, 'Bad input'))));
    expect(await screen.findByText("Couldn't save one of your answers.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(saveQueue.state()).toBe('idle');

    // A save that was still on its way at sign-out is refused afterwards.
    act(() => saveQueue.enqueue('answer', () => Promise.reject(new ApiError(401, 'Not signed in'))));
    await waitFor(() => expect(saveQueue.state()).toBe('failed'));
    handlers['POST /api/auth/login'] = () => json(200, { user: other });
    await signIn('kim');
    expect(await screen.findByRole('link', { name: 'Kim' })).toBeInTheDocument();
    expect(saveQueue.state()).toBe('idle');
    expect(screen.queryByText(/Couldn't save/)).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('keeps what is cached while the same learner stays signed in', async () => {
    handlers['GET /api/dashboard'] = () => json(200, totals(120, 2));
    const client = createQueryClient();
    renderAt('/settings', client);
    expect(await screen.findByText('120 XP')).toBeInTheDocument();
    client.setQueryData(['kept'], 'still here');
    // The settings screen reads the user again after a save.
    handlers['PUT /api/settings'] = () => json(200, { user: { ...learner, hideFromLeaderboard: true } });
    handlers['GET /api/auth/me'] = () => json(200, { user: { ...learner, hideFromLeaderboard: true } });
    await userEvent.click(screen.getByRole('checkbox', { name: /Hide me from the leaderboard/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(await screen.findByText(/Settings saved/)).toBeInTheDocument();
    expect(client.getQueryData(['kept'])).toBe('still here');
  });
});

describe('RequireAdmin', () => {
  it('sends a learner back to the study path', async () => {
    handlers['GET /api/auth/me'] = () => json(200, { user: learner });
    renderAt('/admin');
    expect(await screen.findByRole('heading', { name: 'Study path' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('lets an admin in', async () => {
    handlers['GET /api/auth/me'] = () => json(200, { user: admin });
    renderAt('/admin');
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
  });

  function renderAlone(auth: Pick<AuthValue, 'user' | 'loading'>) {
    const value: AuthValue = { ...auth, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() };
    return render(
      <AuthContext.Provider value={value}>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route path="/admin" element={<RequireAdmin><p>admin only</p></RequireAdmin>} />
            <Route path="/login" element={<p>login page</p>} />
            <Route path="/" element={<p>home page</p>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
  }

  it('on its own, waits while the session is still loading instead of redirecting', () => {
    renderAlone({ user: null, loading: true });
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText('home page')).not.toBeInTheDocument();
    expect(screen.queryByText('admin only')).not.toBeInTheDocument();
  });

  it('on its own, sends a signed-out visitor to the login page', () => {
    renderAlone({ user: null, loading: false });
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('on its own, redirects a learner and admits an admin', () => {
    const asLearner = renderAlone({ user: learner, loading: false });
    expect(screen.getByText('home page')).toBeInTheDocument();
    asLearner.unmount();
    renderAlone({ user: admin, loading: false });
    expect(screen.getByText('admin only')).toBeInTheDocument();
  });
});

describe('invite page', () => {
  beforeEach(() => {
    handlers['GET /api/auth/invite/tok'] = () => json(200, { purpose: 'invite' });
  });

  it('password under 12 chars shows inline error and does not submit', async () => {
    renderAt('/invite/tok');
    await userEvent.type(await screen.findByLabelText('Login name'), 'sam');
    await userEvent.type(screen.getByLabelText('Display name'), 'Sam');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Password must be at least 12 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  });

  it('starts the new account with nothing cached from whoever used the page before', async () => {
    let signedIn = false;
    handlers['GET /api/auth/me'] = () => (signedIn ? json(200, { user: learner }) : json(401, { error: 'Not signed in' }));
    handlers['POST /api/auth/accept-invite'] = () => {
      signedIn = true;
      return json(200, { user: learner });
    };
    handlers['GET /api/dashboard'] = () => new Promise<Response>(() => {});
    const client = createQueryClient();
    renderAt('/invite/tok', client);
    await screen.findByLabelText('Login name');
    client.setQueryData(['dashboard'], totals(120, 2));

    await userEvent.type(screen.getByLabelText('Login name'), 'sam');
    await userEvent.type(screen.getByLabelText('Display name'), 'Sam');
    await userEvent.type(screen.getByLabelText('Password'), 'a long enough password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Study path' })).toBeInTheDocument();
    expect(screen.queryByText('120 XP')).not.toBeInTheDocument();
    expect(client.getQueryData(['dashboard'])).toBeUndefined();
  });

  it('sends Intl time zone, then refreshes auth and goes to the path', async () => {
    let signedIn = false;
    handlers['GET /api/auth/me'] = () => (signedIn ? json(200, { user: learner }) : json(401, { error: 'Not signed in' }));
    handlers['POST /api/auth/accept-invite'] = () => {
      signedIn = true;
      return json(200, { user: learner });
    };
    renderAt('/invite/tok');
    await userEvent.type(await screen.findByLabelText('Login name'), 'sam');
    await userEvent.type(screen.getByLabelText('Display name'), 'Sam');
    await userEvent.type(screen.getByLabelText('Password'), 'a long enough password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Study path' })).toBeInTheDocument();
    expect(postBody('POST /api/auth/accept-invite')).toEqual({
      token: 'tok',
      login: 'sam',
      name: 'Sam',
      password: 'a long enough password',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it.each([404, 410])('shows "This link is no longer valid. Ask for a new one." for a %i token', async (status) => {
    handlers['GET /api/auth/invite/tok'] = () => json(status, { error: 'gone' });
    renderAt('/invite/tok');
    expect(await screen.findByRole('alert')).toHaveTextContent('This link is no longer valid. Ask for a new one.');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByText(FOOTER)).toBeInTheDocument();
  });

  it('shows an error with a retry, not the form, when the link cannot be checked', async () => {
    handlers['GET /api/auth/invite/tok'] = () => json(500, { error: 'Internal error' });
    renderAt('/invite/tok');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't check this link. Try again.");
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();

    handlers['GET /api/auth/invite/tok'] = () => json(200, { purpose: 'invite' });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('reset page', () => {
  it('after success goes to /login with a notice', async () => {
    handlers['GET /api/auth/invite/tok'] = () => json(200, { purpose: 'reset', name: 'Sam' });
    handlers['POST /api/auth/reset'] = () => json(200, { ok: true });
    renderAt('/reset/tok');
    await userEvent.type(await screen.findByLabelText('New password'), 'a brand new password');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Password updated. Sign in with your new password.'));
    expect(screen.getByLabelText('Login name')).toBeInTheDocument();
    expect(postBody('POST /api/auth/reset')).toEqual({ token: 'tok', password: 'a brand new password' });
  });

  it('an invite token on the reset route is invalid', async () => {
    handlers['GET /api/auth/invite/tok'] = () => json(200, { purpose: 'invite' });
    renderAt('/reset/tok');
    expect(await screen.findByRole('alert')).toHaveTextContent('This link is no longer valid');
    expect(screen.getByText(FOOTER)).toBeInTheDocument();
  });

  it('shows an error with a retry, not the form, when the link cannot be checked', async () => {
    handlers['GET /api/auth/invite/tok'] = () => json(500, { error: 'Internal error' });
    renderAt('/reset/tok');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't check this link. Try again.");
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
