import { act, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardResponse, User } from './api/types';
import { AuthContext, type AuthValue } from './features/auth/AuthProvider';
import { createQueryClient } from './queryClient';
import { AppRoutes } from './routes';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const sam: User = { id: 2, login: 'sam', name: 'Sam', role: 'learner', timeZone: 'UTC', examDate: null, hideFromLeaderboard: false };
const kim: User = { ...sam, id: 3, login: 'kim', name: 'Kim' };

const totals = (xp: number, level: number): DashboardResponse => ({
  xp, level, nextLevelXp: 99_999, streak: 0, reviewsDue: 0, domains: [], weakest: [], mockHistory: [],
  readiness: { ready: false, missing: [] }, studyPlan: null, badges: [],
  openMock: null, mockSpec: { questions: 11, minutes: 11, partial: true },
});

let served: DashboardResponse;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/dashboard') return json(200, served);
      if (url === '/api/path') return json(200, { domains: [] });
      throw new Error(`unexpected request ${url}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('routes', () => {
  it('gives each account its own rewards provider: the level of the account before is not the starting point of the next', async () => {
    const client = createQueryClient();
    const auth = (user: User): AuthValue => ({ user, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() });
    const app = (user: User) => (
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth(user)}>
          <MemoryRouter initialEntries={['/']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    );
    served = totals(120, 2);
    const view = render(app(sam));
    expect(await screen.findByText('120 XP')).toBeInTheDocument();

    // Another account takes the place of the first without a sign-out in between (the session was changed
    // in another tab, and this page has just read who is signed in). The auth provider clears what was cached.
    served = totals(5000, 7);
    act(() => client.clear());
    view.rerender(app(kim));
    expect(await screen.findByText('5000 XP')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kim' })).toBeInTheDocument();
    // Level 7 is where this learner starts, not five steps up from the learner before.
    expect(screen.queryByText('Level up')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Rewards' })).toBeEmptyDOMElement();
  });
});
