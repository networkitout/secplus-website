import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../api/types';
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
    'GET /api/dashboard': () => json(200, { xp: 0, level: 1, nextLevelXp: 100, streak: 0 }),
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

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const postBody = (key: string) => JSON.parse(String(fetchMock.mock.calls.find(([u, i]) => `${i?.method ?? 'GET'} ${u}` === key)![1].body));

describe('login form', () => {
  it('redirects a signed-out visitor to /login', async () => {
    renderAt('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('No account? Ask the site owner for an invite link.')).toBeInTheDocument();
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
