import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaderboardResponse, LeaderboardRow, User } from '../../api/types';
import { createQueryClient } from '../../queryClient';
import { AuthContext } from '../auth/AuthProvider';
import { LeaderboardPage } from './LeaderboardPage';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const sam: User = { id: 2, login: 'sam', name: 'Sam', role: 'learner', timeZone: 'UTC', examDate: null, hideFromLeaderboard: false };

const row = (rank: number, userId: number, name: string, xp: number, over: Partial<LeaderboardRow> = {}): LeaderboardRow => ({
  rank, userId, name, level: 2, xp, streak: 3, isMe: false, ...over,
});

const week: LeaderboardResponse = {
  period: 'week',
  rows: [
    row(1, 5, 'Ann', 300, { level: 4, streak: 12 }),
    row(2, 2, 'Sam', 120, { isMe: true, streak: 1 }),
    row(3, 7, 'Bo', 80, { streak: 0 }),
    row(4, 9, 'Cy', 10),
  ],
  me: { rank: 2, xp: 120 },
};

/** Fifty other learners, with the viewer in 51st place. */
const allTime: LeaderboardResponse = {
  period: 'all',
  rows: Array.from({ length: 50 }, (_, i) => row(i + 1, 100 + i, `Learner ${i + 1}`, 5000 - i * 10)),
  me: { rank: 51, xp: 150 },
};

type Handler = () => Response | Promise<Response>;
const WEEK = 'GET /api/leaderboard?period=week';
const ALL = 'GET /api/leaderboard?period=all';
const DASH = 'GET /api/dashboard';
let handlers: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;

const keyOf = (url: unknown, init?: RequestInit) => `${init?.method ?? 'GET'} ${String(url)}`;
const calls = (key: string) => fetchMock.mock.calls.filter(([u, i]) => keyOf(u, i) === key);

beforeEach(() => {
  handlers = {
    [WEEK]: () => json(200, week),
    [ALL]: () => json(200, allTime),
    [DASH]: () => json(200, { xp: 150, level: 2, nextLevelXp: 400, streak: 6 }),
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const h = handlers[keyOf(url, init)];
    if (!h) throw new Error(`unexpected request ${keyOf(url, init)}`);
    return h();
  });
  vi.stubGlobal('fetch', fetchMock);
  client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } }); // no 1 s retry wait
});
afterEach(() => vi.unstubAllGlobals());

function renderBoard(user: User = sam) {
  const auth = { user, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() };
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={['/leaderboard']}>
          <Routes>
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/settings" element={<p>settings screen</p>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

const tab = (name: string) => screen.getByRole('tab', { name });
const bodyRows = (table: HTMLElement) => within(table).getAllByRole('row').slice(1);
const cellsOf = (r: HTMLElement) => within(r).getAllByRole('cell').map((c) => c.textContent);

describe('leaderboard', () => {
  it('leaderboard: switching tabs refetches with period; viewer row has aria-current; pinned row when me.rank > rows.length', async () => {
    renderBoard();
    expect(screen.getByRole('heading', { level: 1, name: 'Leaderboard' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Period' })).toBeInTheDocument();
    expect(tab('This week')).toHaveAttribute('aria-selected', 'true');
    expect(tab('All time')).toHaveAttribute('aria-selected', 'false');

    const table = await screen.findByRole('table', { name: 'Leaderboard: this week' });
    expect(calls(WEEK)).toHaveLength(1);
    expect(calls(ALL)).toHaveLength(0);
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Rank', 'Name', 'Level', 'XP this week', 'Streak']);
    const rows = bodyRows(table);
    expect(rows.map(cellsOf)).toEqual([
      ['1', 'Ann', '4', '300', '12 days'],
      ['2', 'Sam (you)', '2', '120', '1 day'],
      ['3', 'Bo', '2', '80', '0 days'],
      ['4', 'Cy', '2', '10', '3 days'],
    ]);
    // The viewer's row is marked for assistive technology and in text, not by colour alone.
    expect(rows.map((r) => r.getAttribute('aria-current'))).toEqual([null, 'true', null, null]);
    // The top three have a medal with a text alternative.
    expect(within(rows[0]!).getByRole('img', { name: 'First place' })).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('img', { name: 'Second place' })).toBeInTheDocument();
    expect(within(rows[2]!).getByRole('img', { name: 'Third place' })).toBeInTheDocument();
    expect(within(rows[3]!).queryByRole('img')).not.toBeInTheDocument();
    // The table is inside the panel of the selected tab.
    const panel = screen.getByRole('tabpanel', { name: 'This week' });
    expect(panel).toContainElement(table);
    expect(tab('This week')).toHaveAttribute('aria-controls', panel.id);

    await userEvent.click(tab('All time'));
    expect(tab('All time')).toHaveAttribute('aria-selected', 'true');
    expect(tab('This week')).toHaveAttribute('aria-selected', 'false');
    const all = await screen.findByRole('table', { name: 'Leaderboard: all time' });
    expect(calls(ALL)).toHaveLength(1);
    expect(screen.getByRole('tabpanel', { name: 'All time' })).toContainElement(all);
    expect(within(all).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Rank', 'Name', 'Level', 'XP', 'Streak']);

    // 50 rows from the server, then the viewer's own row with their rank. Level and streak are the viewer's own.
    const allRows = bodyRows(all);
    expect(allRows).toHaveLength(51);
    expect(cellsOf(allRows[49]!)).toEqual(['50', 'Learner 50', '2', '4510', '3 days']);
    const pinned = allRows[50]!;
    expect(cellsOf(pinned)).toEqual(['Your rank: 51', 'Sam (you)', '2', '150', '6 days']);
    expect(pinned).toHaveAttribute('aria-current', 'true');
    expect(allRows.filter((r) => r.getAttribute('aria-current'))).toHaveLength(1);
  });

  it('arrow keys move between the tabs and select them; Tab leaves the tab list', async () => {
    renderBoard();
    await screen.findByRole('table', { name: 'Leaderboard: this week' });
    expect(tab('This week')).toHaveAttribute('tabindex', '0');
    expect(tab('All time')).toHaveAttribute('tabindex', '-1');

    tab('This week').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('All time')).toHaveFocus();
    expect(tab('All time')).toHaveAttribute('aria-selected', 'true');
    expect(tab('All time')).toHaveAttribute('tabindex', '0');
    expect(await screen.findByRole('table', { name: 'Leaderboard: all time' })).toBeInTheDocument();

    await userEvent.keyboard('{ArrowRight}'); // wraps round
    expect(tab('This week')).toHaveFocus();
    expect(tab('This week')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(tab('All time')).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(tab('This week')).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(tab('All time')).toHaveFocus();
    expect(tab('All time')).toHaveAttribute('aria-selected', 'true');

    await userEvent.tab();
    expect(screen.getByRole('tabpanel', { name: 'All time' })).toHaveFocus();
  });

  it('leaderboard: hidden viewer note; empty state', async () => {
    handlers[WEEK] = () => json(200, { period: 'week', rows: [week.rows[0], week.rows[2]], me: null });
    const hidden = renderBoard({ ...sam, hideFromLeaderboard: true });
    const table = await screen.findByRole('table', { name: 'Leaderboard: this week' });
    expect(bodyRows(table).map((r) => cellsOf(r)[1])).toEqual(['Ann', 'Bo']);
    expect(screen.queryByText(/\(you\)/)).not.toBeInTheDocument();
    const note = screen.getByText(/You are hidden from the leaderboard/);
    expect(note).toHaveTextContent('You are hidden from the leaderboard, so other learners do not see you here. You can change this in Settings.');
    expect(within(note).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    hidden.unmount();
    client.clear();

    handlers[WEEK] = () => json(200, { period: 'week', rows: [], me: null });
    handlers[ALL] = () => json(200, { period: 'all', rows: [], me: null });
    renderBoard();
    expect(await screen.findByText('No XP yet this week — be the first.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(/You are hidden/)).not.toBeInTheDocument();
    await userEvent.click(tab('All time'));
    expect(await screen.findByText('No XP yet — be the first.')).toBeInTheDocument();
  });

  it('tells a visible viewer without XP in the period why they are not on the board', async () => {
    handlers[WEEK] = () => json(200, { period: 'week', rows: [week.rows[0]], me: null });
    renderBoard();
    await screen.findByRole('table', { name: 'Leaderboard: this week' });
    expect(screen.getByText('You have no XP this week yet, so you are not on the board.')).toBeInTheDocument();
    expect(screen.queryByText(/You are hidden/)).not.toBeInTheDocument();
  });

  it('shows the viewer once when they are inside the rows, and nothing but the shared fields', async () => {
    renderBoard();
    const table = await screen.findByRole('table', { name: 'Leaderboard: this week' });
    expect(bodyRows(table)).toHaveLength(4);
    expect(screen.getAllByText(/\(you\)/)).toHaveLength(1);
    expect(table).not.toHaveTextContent(/mock|mastery|ready|score|login/i);
  });

  it('a failed refresh keeps the rows on screen and says so', async () => {
    renderBoard();
    const table = await screen.findByRole('table', { name: 'Leaderboard: this week' });
    handlers[WEEK] = () => Promise.reject(new TypeError('Failed to fetch'));
    await act(() => client.refetchQueries({ queryKey: ['leaderboard'] }));
    expect(await screen.findByText("Couldn't refresh the leaderboard. What you see may be out of date.")).toBeInTheDocument();
    expect(table).toBeInTheDocument();
    expect(bodyRows(table)).toHaveLength(4);

    handlers[WEEK] = () => json(200, week);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/Couldn't refresh/)).not.toBeInTheDocument());
  });

  it('a server error offers "Try again"', async () => {
    handlers[WEEK] = () => json(500, { error: 'Internal error' });
    renderBoard();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the leaderboard.");
    handlers[WEEK] = () => json(200, week);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Leaderboard: this week' })).toBeInTheDocument();
  });
});
