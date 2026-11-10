import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, useQuery, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { DashboardBadge, DashboardResponse } from '../../api/types';
import { createQueryClient } from '../../queryClient';
import { RewardsBanner, RewardsProvider, ScreenCelebration, useRewards, type RewardsValue } from './RewardsProvider';

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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

/** The one live region of the banner. It is on the page whether or not a celebration is in it. */
const banner = () => screen.getByRole('status');
const shows = (text: string) => waitFor(() => expect(banner()).toHaveTextContent(text));
const dismiss = () => userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
const reserved = () => document.documentElement.style.getPropertyValue('--celebration-space');
const covered = () => document.documentElement.style.getPropertyValue('--celebration-cover');

describe('rewards', () => {
  it('rewards: report with XP crossing a level boundary queues a level-up Celebration; two badges show one after another', async () => {
    renderRewards();
    expect(await screen.findByText('390 XP, level 2')).toBeInTheDocument();
    expect(banner()).toBeEmptyDOMElement();

    served = dashboard({ xp: 410, level: 3, nextLevelXp: 900 });
    act(() => rewards.report({ xp: 20, newBadges: ['first-lesson', 'streak-3'] }));

    // The badges are known at once; the level is known when the header's numbers have been read again.
    await shows('Badge earned');
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
    expect(banner()).toBeEmptyDOMElement();
  });

  it('XP that crosses several levels at once shows one celebration, naming the new level', async () => {
    served = dashboard({ xp: 90, level: 1, nextLevelXp: 100 });
    renderRewards();
    await screen.findByText('90 XP, level 1');

    served = dashboard({ xp: 990, level: 4, nextLevelXp: 1600 });
    act(() => rewards.report({ xp: 900 }));
    await shows('Level 4');

    await dismiss();
    expect(banner()).toBeEmptyDOMElement();
  });

  it('XP that stays inside the level refreshes the header and shows nothing', async () => {
    served = dashboard({ xp: 100, level: 2, nextLevelXp: 400 });
    renderRewards();
    await screen.findByText('100 XP, level 2');

    served = dashboard({ xp: 120, level: 2, nextLevelXp: 400 });
    act(() => rewards.report({ xp: 20, newBadges: [] }));
    expect(await screen.findByText('120 XP, level 2')).toBeInTheDocument();
    expect(banner()).toBeEmptyDOMElement();
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
    expect(banner()).toBeEmptyDOMElement();
    expect(requests()).toEqual([DASH]);
  });

  it('the same badge reported twice shows once', async () => {
    renderRewards();
    await screen.findByText('390 XP, level 2');
    act(() => rewards.report({ newBadges: ['first-lesson', 'first-lesson'] }));
    act(() => rewards.report({ xp: 0, newBadges: ['first-lesson'] }));
    await shows('First Lesson');

    await dismiss();
    expect(banner()).toBeEmptyDOMElement();
    act(() => rewards.report({ newBadges: ['first-lesson'] }));
    expect(banner()).toBeEmptyDOMElement();
  });

  it('a report that arrives while a celebration is showing waits behind it', async () => {
    renderRewards();
    await screen.findByText('390 XP, level 2');
    act(() => rewards.report({ newBadges: ['first-lesson'] }));
    await shows('First Lesson');

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
    expect(banner()).toBeEmptyDOMElement(); // the badge has no name yet
    expect(requests()).toEqual([DASH]);

    // The first answer was computed before the XP was earned; the one after it has the new level.
    served = dashboard({ xp: 440, level: 3, nextLevelXp: 900 });
    respond = () => json(200, served);
    await act(async () => first(json(200, dashboard({ xp: 390, level: 2 }))));

    await shows('First Lesson');
    expect(await screen.findByText('440 XP, level 3')).toBeInTheDocument();
    expect(requests()).toEqual([DASH, DASH]);
    await dismiss();
    expect(banner()).toHaveTextContent('Level 3');
  });

  it('the level the learner already had when the page loaded is not celebrated', async () => {
    served = dashboard({ xp: 2500, level: 6, nextLevelXp: 3600 });
    renderRewards();
    await screen.findByText('2500 XP, level 6');
    expect(banner()).toBeEmptyDOMElement();
  });

  it('a badge the dashboard does not know still shows, without a description', async () => {
    renderRewards();
    await screen.findByText('390 XP, level 2');
    act(() => rewards.report({ newBadges: ['brand-new-badge'] }));
    await shows('New badge');
  });

  it('keeps keyboard focus by the banner when a celebration is dismissed', async () => {
    renderRewards();
    await screen.findByText('390 XP, level 2');
    act(() => rewards.report({ newBadges: ['first-lesson'] }));
    await shows('First Lesson');

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(banner()).toBeEmptyDOMElement();
    expect(document.body).not.toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('the celebration is put into a live region that was on the page before it, without taking focus or moving the page', async () => {
    const view = renderRewards();
    await screen.findByText('390 XP, level 2');
    // The region is there, empty, from the start: one that arrived with its text might not be announced.
    const region = banner();
    expect(region).toBeEmptyDOMElement();
    expect(reserved()).toBe('');
    const after = screen.getByRole('button', { name: 'After' });
    after.focus();

    act(() => rewards.report({ newBadges: ['first-lesson'] }));
    await shows('Badge earned');
    expect(banner()).toBe(region);
    // The text is in that one region: the celebration is not a second live region inside it.
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(after).toHaveFocus();
    // It lies over the bottom of the window, out of the flow of the page, and clicks beside it reach the page.
    expect(region.parentElement).toHaveClass('fixed', 'bottom-0', 'pointer-events-none');
    expect(region).toHaveClass('pointer-events-auto');
    // While it shows, the page keeps room for it at its end; afterwards the room is given back.
    expect(reserved()).toMatch(/^\d+px$/);

    await dismiss();
    expect(region).toBeEmptyDOMElement();
    expect(reserved()).toBe('');

    act(() => rewards.report({ newBadges: ['streak-3'] }));
    await shows('Three-Day Streak');
    view.unmount();
    expect(reserved()).toBe('');
  });

  it('keeps room at the end of the page while a celebration shows, and gives back only what the page is not scrolled into', async () => {
    // A page of 2000 px in a window of 800 px; the banner is 114 px high.
    const page = { height: 2000, scrollY: 0 };
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(114);
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockImplementation(() => page.height + (parseFloat(reserved()) || 0));
    vi.stubGlobal('innerHeight', 800);
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => page.scrollY);
    const scrollTo = (y: number) => {
      page.scrollY = y;
      fireEvent.scroll(window);
    };
    renderRewards();
    await screen.findByText('390 XP, level 2');

    act(() => rewards.report({ newBadges: ['first-lesson'] }));
    await shows('First Lesson');
    // The page can be scrolled 114 px further, and what is brought into view stops above the banner.
    expect(reserved()).toBe('114px');
    expect(covered()).toBe('114px');

    // The learner scrolls 60 px into that room, to reach a button the banner lay over.
    scrollTo(1260);
    expect(reserved()).toBe('114px');
    await dismiss();
    // Nothing is covered any more. The 60 px on screen stay: without them the whole page would jump.
    expect(covered()).toBe('');
    expect(reserved()).toBe('60px');
    scrollTo(1230);
    expect(reserved()).toBe('30px');
    scrollTo(900);
    expect(reserved()).toBe('');

    // Not scrolled into it at all: everything is given back at once.
    act(() => rewards.report({ newBadges: ['streak-3'] }));
    await shows('Three-Day Streak');
    expect(reserved()).toBe('114px');
    await dismiss();
    expect(reserved()).toBe('');
    expect(covered()).toBe('');
  });

  it("a screen's own celebration comes first: levels and badges wait until it has gone, then show one at a time", async () => {
    function Screen() {
      const [passed, setPassed] = useState(false);
      const { report } = useRewards();
      return (
        <main>
          <button
            type="button"
            onClick={() => {
              setPassed(true);
              report({ xp: 130, newBadges: ['first-quiz-pass'] });
            }}
          >
            Finish
          </button>
          {passed && <ScreenCelebration kind="quiz-pass" title="Objective 1.1" detail="+130 XP" onDone={() => setPassed(false)} />}
        </main>
      );
    }
    render(
      <QueryClientProvider client={client}>
        <RewardsProvider>
          <Header />
          <RewardsBanner />
          <Screen />
        </RewardsProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('390 XP, level 2');
    const own = () => within(screen.getByRole('main')).queryByRole('status');
    const region = banner();

    served = dashboard({ xp: 520, level: 3, nextLevelXp: 900 });
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(own()).toHaveTextContent('Quiz passed');
    // The header has its new numbers, so the level-up is known; it and the badge wait all the same.
    expect(await screen.findByText('520 XP, level 3')).toBeInTheDocument();
    expect(region).toBeEmptyDOMElement();
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(1);

    await dismiss();
    expect(own()).not.toBeInTheDocument();
    expect(region).toHaveTextContent('Badge earned');
    expect(region).toHaveTextContent('Quiz Passer');
    await dismiss();
    expect(region).toHaveTextContent('Level up');
    expect(region).toHaveTextContent('Level 3');
    await dismiss();
    expect(region).toBeEmptyDOMElement();
  });

  it('a report from a screen that has gone is as good as any other', async () => {
    let late!: RewardsValue['report'];
    function Screen() {
      late = useRewards().report;
      return <p>a screen</p>;
    }
    function Page({ open }: { open: boolean }) {
      return (
        <QueryClientProvider client={client}>
          <RewardsProvider>
            <Header />
            <RewardsBanner />
            {open && <Screen />}
          </RewardsProvider>
        </QueryClientProvider>
      );
    }
    const view = render(<Page open />);
    await screen.findByText('390 XP, level 2');
    view.rerender(<Page open={false} />);
    expect(screen.queryByText('a screen')).not.toBeInTheDocument();

    // The response to a request the screen sent arrives after the learner has left it.
    served = dashboard({ xp: 400, level: 3, nextLevelXp: 900 });
    act(() => late({ xp: 10, newBadges: ['first-lesson'] }));
    await shows('First Lesson');
    expect(await screen.findByText('400 XP, level 3')).toBeInTheDocument();
    expect(requests()).toEqual([DASH, DASH]);
  });

  describe('the read of the dashboard after a report', () => {
    // Only the timers are faked: the mocked responses still need real turns of the event loop to be read.
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));

    const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
    /**
     * Lets requests that have been answered, and the updates they cause, finish. The clock moves by a few
     * milliseconds at the end: an update that is scheduled from inside a timer is due a millisecond later.
     */
    async function settle() {
      for (let i = 0; i < 6; i++) {
        await act(async () => {
          await new Promise((r) => setImmediate(r));
          await vi.advanceTimersByTimeAsync(0);
        });
      }
      await advance(5);
    }

    it('reports that follow each other closely share one read, the badge does not wait for it, and a level-up is still found', async () => {
      renderRewards();
      await settle();
      expect(screen.getByText('390 XP, level 2')).toBeInTheDocument();

      // Three answers in a row, each within the wait of the one before.
      served = dashboard({ xp: 450, level: 3, nextLevelXp: 900 });
      act(() => rewards.report({ xp: 20 }));
      await advance(200);
      act(() => rewards.report({ xp: 20 }));
      await advance(200);
      act(() => rewards.report({ xp: 20, newBadges: ['first-lesson'] }));
      // The badge is celebrated at once.
      expect(banner()).toHaveTextContent('First Lesson');
      await advance(299);
      await act(() => new Promise((r) => setImmediate(r)));
      expect(requests()).toEqual([DASH]);

      // The read follows the last report, and has what all three earned.
      await advance(1);
      await settle();
      expect(requests()).toEqual([DASH, DASH]);
      expect(screen.getByText('450 XP, level 3')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(banner()).toHaveTextContent('Level up');
      expect(banner()).toHaveTextContent('Level 3');

      // A report on its own is followed by its own read.
      served = dashboard({ xp: 460, level: 3, nextLevelXp: 900 });
      act(() => rewards.report({ xp: 10 }));
      await advance(300);
      await settle();
      expect(requests()).toEqual([DASH, DASH, DASH]);
      expect(screen.getByText('460 XP, level 3')).toBeInTheDocument();
    });

    it('a read that is still waiting when the learner signs out is dropped', async () => {
      const view = renderRewards();
      await settle();
      act(() => rewards.report({ xp: 20 }));
      view.unmount();
      await advance(1000);
      await settle();
      expect(requests()).toEqual([DASH]);
    });
  });

  describe('timing', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it('celebrations dismiss themselves one at a time, each after its own few seconds', async () => {
      renderRewards();
      await screen.findByText('390 XP, level 2');
      act(() => rewards.report({ newBadges: ['first-lesson', 'first-quiz-pass'] }));
      await shows('First Lesson');

      act(() => { vi.advanceTimersByTime(6500); });
      expect(banner()).toHaveTextContent('Quiz Passer');
      act(() => { vi.advanceTimersByTime(3000); });
      expect(banner()).toHaveTextContent('Quiz Passer'); // its own six seconds have not passed
      act(() => { vi.advanceTimersByTime(3500); });
      expect(banner()).toBeEmptyDOMElement();
    });
  });
});
