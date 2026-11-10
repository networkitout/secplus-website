import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, useQuery, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { DashboardBadge, DashboardResponse } from '../../api/types';
import { createQueryClient } from '../../queryClient';
import { RewardsBanner, RewardsProvider, useRewards, type RewardsValue } from './RewardsProvider';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const badge = (id: string, title: string, description: string): DashboardBadge => ({ id, title, description, earnedAt: null });
const BADGES = [
  badge('first-lesson', 'First Lesson', 'Complete your first lesson.'),
  badge('first-quiz-pass', 'Quiz Passer', 'Pass an objective quiz.'),
  badge('streak-3', 'Three-Day Streak', 'Study three days in a row.'),
];

const dashboard = (over: Partial<DashboardResponse> = {}): DashboardResponse => ({
  xp: 390, level: 2, nextLevelXp: 400, streak: 1, reviewsDue: 0, domains: [], weakest: [], mockHistory: [],
  readiness: { ready: false, missing: [] }, studyPlan: null, badges: BADGES,
  openMock: null, mockSpec: { questions: 11, minutes: 11, partial: true }, ...over,
});

const DASH = 'GET /api/dashboard';
let served: DashboardResponse;
let respond: () => Response | Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;
let rewards: RewardsValue;

const keyOf = (url: unknown, init?: RequestInit) => `${init?.method ?? 'GET'} ${String(url)}`;
const requests = () => fetchMock.mock.calls.map(([u, i]) => keyOf(u, i));

beforeEach(() => {
  served = dashboard();
  respond = () => json(200, served);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (keyOf(url, init) !== DASH) throw new Error(`unexpected request ${keyOf(url, init)}`);
    return respond();
  });
  vi.stubGlobal('fetch', fetchMock);
  client = createQueryClient();
});
afterEach(() => vi.unstubAllGlobals());

function Grab() {
  rewards = useRewards();
  return null;
}

/** What the header does: reads the same query. */
function Header() {
  const stats = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardResponse>('dashboard') });
  return <p>{stats.data ? `${stats.data.xp} XP, level ${stats.data.level}` : 'no stats yet'}</p>;
}

function renderRewards() {
  return render(
    <QueryClientProvider client={client}>
      <RewardsProvider>
        <Header />
        <RewardsBanner />
        <Grab />
        <button type="button">After</button>
      </RewardsProvider>
    </QueryClientProvider>,
  );
}

const banner = () => screen.queryByRole('status');
const dismiss = () => userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

describe('rewards', () => {
  it('rewards: report with XP crossing a level boundary queues a level-up Celebration; two badges show one after another', async () => {
    renderRewards();
    expect(await screen.findByText('390 XP, level 2')).toBeInTheDocument();
    expect(banner()).not.toBeInTheDocument();

    served = dashboard({ xp: 410, level: 3, nextLevelXp: 900 });
    act(() => rewards.report({ xp: 20, newBadges: ['first-lesson', 'streak-3'] }));

    // The badges are known at once; the level is known when the header's numbers have been read again.
    expect(await screen.findByRole('status')).toHaveTextContent('Badge earned');
    expect(banner()).toHaveTextContent('First Lesson');
    expect(banner()).toHaveTextContent('Complete your first lesson.');
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(1);
    expect(await screen.findByText('410 XP, level 3')).toBeInTheDocument();
    expect(banner()).toHaveTextContent('First Lesson'); // still the first one

    await dismiss();
    expect(banner()).toHaveTextContent('Three-Day Streak');
    expect(banner()).toHaveTextContent('Study three days in a row.');
    expect(banner()).not.toHaveTextContent('First Lesson');

    await dismiss();
    expect(banner()).toHaveTextContent('Level up');
    expect(banner()).toHaveTextContent('Level 3');

    await dismiss();
    expect(banner()).not.toBeInTheDocument();
  });

  it('XP that crosses several levels at once shows one celebration, naming the new level', async () => {
    served = dashboard({ xp: 90, level: 1, nextLevelXp: 100 });
    renderRewards();
    await screen.findByText('90 XP, level 1');

    served = dashboard({ xp: 990, level: 4, nextLevelXp: 1600 });
    act(() => rewards.report({ xp: 900 }));
    expect(await screen.findByRole('status')).toHaveTextContent('Level 4');

    await dismiss();
    expect(banner()).not.toBeInTheDocument();
  });

  it('XP that stays inside the level refreshes the header and shows nothing', async () => {
    served = dashboard({ xp: 100, level: 2, nextLevelXp: 400 });
    renderRewards();
    await screen.findByText('100 XP, level 2');

    served = dashboard({ xp: 120, level: 2, nextLevelXp: 400 });
    act(() => rewards.report({ xp: 20, newBadges: [] }));
    expect(await screen.findByText('120 XP, level 2')).toBeInTheDocument();
    expect(banner()).not.toBeInTheDocument();
    // One more read of the dashboard, and no other request.
    expect(requests()).toEqual([DASH, DASH]);
  });

  it('a report with nothing new shows nothing and asks the server nothing', async () => {
    renderRewards();
    await screen.findByText('390 XP, level 2');
    act(() => {
      rewards.report({});
      rewards.report({ xp: 0, newBadges: [] });
    });
    await act(async () => {});
    expect(banner()).not.toBeInTheDocument();
    expect(requests()).toEqual([DASH]);
  });

  it('the same badge reported twice shows once', async () => {
    renderRewards();
    await screen.findByText('390 XP, level 2');
    act(() => rewards.report({ newBadges: ['first-lesson', 'first-lesson'] }));
    act(() => rewards.report({ xp: 0, newBadges: ['first-lesson'] }));
    expect(await screen.findByRole('status')).toHaveTextContent('First Lesson');

    await dismiss();
    expect(banner()).not.toBeInTheDocument();
    act(() => rewards.report({ newBadges: ['first-lesson'] }));
    expect(banner()).not.toBeInTheDocument();
  });

  it('a report that arrives while a celebration is showing waits behind it', async () => {
    renderRewards();
    await screen.findByText('390 XP, level 2');
    act(() => rewards.report({ newBadges: ['first-lesson'] }));
    expect(await screen.findByRole('status')).toHaveTextContent('First Lesson');

    act(() => rewards.report({ newBadges: ['first-quiz-pass'] }));
    expect(banner()).toHaveTextContent('First Lesson');
    expect(banner()).not.toHaveTextContent('Quiz Passer');

    await dismiss();
    expect(banner()).toHaveTextContent('Quiz Passer');
    expect(banner()).toHaveTextContent('Pass an objective quiz.');
  });

  it('a report before the first dashboard response waits for it, then reads the numbers again', async () => {
    let first!: (r: Response) => void;
    respond = () => new Promise<Response>((resolve) => (first = resolve));
    renderRewards();
    await waitFor(() => expect(requests()).toEqual([DASH]));

    act(() => rewards.report({ xp: 50, newBadges: ['first-lesson'] }));
    expect(banner()).not.toBeInTheDocument(); // the badge has no name yet
    expect(requests()).toEqual([DASH]);

    // The first answer was computed before the XP was earned; the one after it has the new level.
    served = dashboard({ xp: 440, level: 3, nextLevelXp: 900 });
    respond = () => json(200, served);
    await act(async () => first(json(200, dashboard({ xp: 390, level: 2 }))));

    expect(await screen.findByRole('status')).toHaveTextContent('First Lesson');
    expect(await screen.findByText('440 XP, level 3')).toBeInTheDocument();
    expect(requests()).toEqual([DASH, DASH]);
    await dismiss();
    expect(banner()).toHaveTextContent('Level 3');
  });

  it('the level the learner already had when the page loaded is not celebrated', async () => {
    served = dashboard({ xp: 2500, level: 6, nextLevelXp: 3600 });
    renderRewards();
    await screen.findByText('2500 XP, level 6');
    expect(banner()).not.toBeInTheDocument();
  });

  it('a badge the dashboard does not know still shows, without a description', async () => {
    renderRewards();
    await screen.findByText('390 XP, level 2');
    act(() => rewards.report({ newBadges: ['brand-new-badge'] }));
    expect(await screen.findByRole('status')).toHaveTextContent('New badge');
  });

  it('keeps keyboard focus by the banner when a celebration is dismissed', async () => {
    renderRewards();
    await screen.findByText('390 XP, level 2');
    act(() => rewards.report({ newBadges: ['first-lesson'] }));
    await screen.findByRole('status');

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(banner()).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  describe('timing', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it('celebrations dismiss themselves one at a time, each after its own few seconds', async () => {
      renderRewards();
      await screen.findByText('390 XP, level 2');
      act(() => rewards.report({ newBadges: ['first-lesson', 'first-quiz-pass'] }));
      expect(await screen.findByRole('status')).toHaveTextContent('First Lesson');

      act(() => { vi.advanceTimersByTime(6500); });
      expect(banner()).toHaveTextContent('Quiz Passer');
      act(() => { vi.advanceTimersByTime(3000); });
      expect(banner()).toHaveTextContent('Quiz Passer'); // its own six seconds have not passed
      act(() => { vi.advanceTimersByTime(3500); });
      expect(banner()).not.toBeInTheDocument();
    });
  });
});
