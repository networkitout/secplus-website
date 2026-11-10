import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../api/types';
import { createQueryClient } from '../../queryClient';
import { AppRoutes } from '../../routes';
import { AuthProvider } from './AuthProvider';

const learner: User = { id: 2, login: 'sam', name: 'Sam', role: 'learner', timeZone: 'UTC', examDate: null, hideFromLeaderboard: false };
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
  });
});
