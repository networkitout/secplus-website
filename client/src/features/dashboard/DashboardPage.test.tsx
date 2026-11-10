import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onlineManager, QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardBadge, DashboardResponse, MockHistoryEntry, User } from '../../api/types';
import { AuthContext } from '../auth/AuthProvider';
import { createQueryClient } from '../../queryClient';
import { formatCalendarDate, formatInstant } from '../../lib/dates';
import { DashboardPage } from './DashboardPage';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const learner: User = { id: 2, login: 'sam', name: 'Sam', role: 'learner', timeZone: 'UTC', examDate: null, hideFromLeaderboard: false };

const badge = (id: string, title: string, description: string): DashboardBadge => ({ id, title, description, earnedAt: null });
const BADGES = [
  badge('first-lesson', 'First Lesson', 'Complete your first lesson.'),
  badge('first-quiz-pass', 'Quiz Passer', 'Pass an objective quiz.'),
  badge('domain-1-complete', 'Domain 1 Complete', 'Pass the Domain 1 exam.'),
  badge('streak-3', 'Three-Day Streak', 'Study three days in a row.'),
  badge('streak-7', 'Week Streak', 'Study seven days in a row.'),
  badge('streak-30', 'Month Streak', 'Study thirty days in a row.'),
  badge('hundred-correct', 'Hundred Correct', 'Answer 100 questions correctly.'),
  badge('lab-rat', 'Lab Rat', 'Pass three different labs.'),
  badge('first-mock-pass', 'Mock Exam Passed', 'Pass a mock exam.'),
];

const DOMAIN_TITLES = [
  'General Security Concepts',
  'Threats, Vulnerabilities, and Mitigations',
  'Security Architecture',
  'Security Operations',
  'Security Program Management and Oversight',
];

const MISSING_NEW = [
  'Content for all five domains is not available yet',
  'Take 3 more mock exams',
  ...[1, 2, 3, 4, 5].map((d) => `Domain ${d} mastery is 0%; aim for 80%`),
];

/** What the server sends for a learner who has done nothing yet. */
const fresh = (over: Partial<DashboardResponse> = {}): DashboardResponse => ({
  xp: 0, level: 1, nextLevelXp: 100, streak: 0, reviewsDue: 0,
  domains: DOMAIN_TITLES.map((title, i) => ({ id: i + 1, title, mastery: 0 })),
  weakest: [],
  mockHistory: [],
  readiness: { ready: false, missing: MISSING_NEW },
  studyPlan: null,
  badges: BADGES,
  openMock: null,
  mockSpec: { questions: 11, minutes: 11, partial: true },
  ...over,
});

const mock = (id: number, scaledScore: number, over: Partial<MockHistoryEntry> = {}): MockHistoryEntry => ({
  id, submittedAt: `2026-11-0${id}T10:00:00.000Z`, scaledScore, passed: scaledScore >= 750, partial: false, ...over,
});

type Handler = () => Response | Promise<Response>;
const DASH = 'GET /api/dashboard';
let handler: Handler;
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;

beforeEach(() => {
  handler = () => json(200, fresh());
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    if (key !== DASH) throw new Error(`unexpected request ${key}`);
    return handler();
  });
  vi.stubGlobal('fetch', fetchMock);
  client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } }); // no 1 s retry wait
});
afterEach(() => {
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

function renderDashboard(user: User = learner) {
  const auth = { user, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() };
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/review" element={<p>review screen</p>} />
            <Route path="/settings" element={<p>settings screen</p>} />
            <Route path="/exam" element={<p>exam screen</p>} />
            <Route path="/practice/:objective" element={<p>practice screen</p>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

const region = (name: string) => screen.findByRole('region', { name });

describe('dashboard', () => {
  it('dashboard: new learner renders with zeros and "Not yet" plus each missing reason', async () => {
    renderDashboard();
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    const loading = screen.getByRole('status');
    expect(loading).toHaveTextContent('Loading your dashboard…');

    const readiness = await region('Exam readiness');
    expect(loading).toBeInTheDocument();
    expect(loading).toBeEmptyDOMElement();
    expect(within(readiness).getByText('Not yet')).toBeInTheDocument();
    expect(within(readiness).queryByText('Ready')).not.toBeInTheDocument();
    expect(within(readiness).getAllByRole('listitem').map((li) => li.textContent)).toEqual(MISSING_NEW);
    expect(readiness).toHaveTextContent(/estimate/i);

    const progress = await region('Your progress');
    expect(progress).toHaveTextContent('Level1');
    expect(progress).toHaveTextContent('XP0');
    expect(progress).toHaveTextContent('100 XP to level 2');
    expect(progress).toHaveTextContent('Streak0 days');

    expect(await region('Reviews')).toHaveTextContent('No reviews due today.');
    expect(screen.queryByRole('link', { name: 'Start review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Study plan' })).not.toBeInTheDocument();

    const mastery = await region('Mastery by domain');
    const bars = within(mastery).getAllByRole('progressbar');
    expect(bars.map((b) => b.getAttribute('aria-label'))).toEqual(DOMAIN_TITLES.map((t, i) => `Domain ${i + 1}: ${t}`));
    for (const bar of bars) expect(bar).toHaveAttribute('aria-valuenow', '0');

    expect(await region('Weakest objectives')).toHaveTextContent('Answer some questions, and the objectives that need the most work appear here.');
    expect(screen.queryByRole('link', { name: /Practice now/ })).not.toBeInTheDocument();

    // No chart with empty axes, and no empty table.
    const history = await region('Practice exam history');
    expect(history).toHaveTextContent('No practice exams yet.');
    expect(within(history).queryByRole('img')).not.toBeInTheDocument();
    expect(within(history).queryByRole('table')).not.toBeInTheDocument();
    expect(within(history).getByRole('link', { name: 'Go to the exam page' })).toHaveAttribute('href', '/exam');

    const badges = within(await region('Badges')).getAllByRole('listitem');
    expect(badges).toHaveLength(BADGES.length);
    for (const [i, item] of badges.entries()) {
      expect(item).toHaveTextContent(BADGES[i]!.title);
      expect(item).toHaveTextContent('Not earned yet');
      expect(item).toHaveTextContent(BADGES[i]!.description);
    }
    expect(await region('Badges')).toHaveTextContent(`0 of ${BADGES.length} earned`);

    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('dashboard: study plan line appears only with an exam date; a past date shows "Your exam date has passed — update it in Settings"', async () => {
    const first = renderDashboard();
    await region('Exam readiness');
    expect(screen.queryByRole('region', { name: 'Study plan' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/to your exam|exam date/i);
    first.unmount();
    client.clear();

    const message = '10 days to your exam: pass 1 objective quiz a day and clear 4 reviews today.';
    handler = () => json(200, fresh({ studyPlan: { daysLeft: 10, objectivesPerDay: 1, message } }));
    const second = renderDashboard({ ...learner, examDate: '2026-11-20' });
    const plan = await region('Study plan');
    expect(plan).toHaveTextContent(message);
    expect(plan).toHaveTextContent(`Exam date: ${formatCalendarDate('2026-11-20')}`);
    expect(within(plan).getByText(formatCalendarDate('2026-11-20'))).toHaveAttribute('datetime', '2026-11-20');
    second.unmount();
    client.clear();

    handler = () =>
      json(200, fresh({ studyPlan: { daysLeft: -3, objectivesPerDay: 28, message: 'Your exam date has passed. Update it in settings.' } }));
    renderDashboard({ ...learner, examDate: '2026-11-07' });
    const past = await region('Study plan');
    expect(past).toHaveTextContent('Your exam date has passed — update it in Settings');
    expect(past).not.toHaveTextContent('Update it in settings.');
    expect(past).not.toHaveTextContent('28');
    await userEvent.click(within(past).getByRole('link', { name: 'Settings' }));
    expect(screen.getByText('settings screen')).toBeInTheDocument();
  });

  it('dashboard: chart has a table alternative listing each mock score', async () => {
    const mocks = [mock(1, 640), mock(2, 720, { partial: true }), mock(3, 790)];
    handler = () => json(200, fresh({ mockHistory: mocks }));
    renderDashboard();
    const history = await region('Practice exam history');
    expect(history).toHaveTextContent(/estimate/i);

    const chart = within(history).getByRole('img', { name: /3 practice exam scores/ });
    expect(chart.tagName.toLowerCase()).toBe('svg');
    expect(chart.querySelectorAll('[data-point]')).toHaveLength(3);
    const passLine = chart.querySelector('line[stroke-dasharray]');
    expect(passLine).not.toBeNull();
    expect(chart).toHaveTextContent('Pass mark 750');
    // 750 lies between the 700 and 900 grid lines.
    const y = (el: Element | null) => Number(el?.getAttribute('y1'));
    expect(y(passLine)).toBeLessThan(y(chart.querySelector('[data-grid="700"]')));
    expect(y(passLine)).toBeGreaterThan(y(chart.querySelector('[data-grid="900"]')));
    expect(chart.outerHTML).not.toMatch(/NaN|#[0-9a-f]{3,8}\b|rgb\(/i); // tokens only, and real numbers

    const table = within(history).getByRole('table', { name: /Practice exam scores/ });
    const rows = within(table).getAllByRole('row');
    expect(within(rows[0]!).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Date', 'Score (estimate)', 'Result', 'Coverage',
    ]);
    // Newest first.
    const cells = rows.slice(1).map((row) => within(row).getAllByRole('cell').map((c) => c.textContent));
    expect(cells).toEqual([
      [formatInstant(mocks[2]!.submittedAt, 'UTC'), '790', 'Passed', 'All domains'],
      [formatInstant(mocks[1]!.submittedAt, 'UTC'), '720', 'Not passed', 'Partial'],
      [formatInstant(mocks[0]!.submittedAt, 'UTC'), '640', 'Not passed', 'All domains'],
    ]);
    expect(rows[1]!.querySelector('time')).toHaveAttribute('datetime', mocks[2]!.submittedAt);
    // The server leaves partial exams out of readiness; with one in the list, the page says so.
    expect(history).toHaveTextContent('A partial practice exam covers only the domains that have content. It does not count toward exam readiness.');
  });

  it('a single mock exam is one point in the middle of the chart, with real coordinates', async () => {
    handler = () => json(200, fresh({ mockHistory: [mock(1, 100)] }));
    renderDashboard();
    const chart = within(await region('Practice exam history')).getByRole('img', { name: /1 practice exam score\b/ });
    const points = chart.querySelectorAll('[data-point]');
    expect(points).toHaveLength(1);
    expect(Number.isFinite(Number(points[0]!.getAttribute('cx')))).toBe(true);
    expect(Number.isFinite(Number(points[0]!.getAttribute('cy')))).toBe(true);
    expect(chart.outerHTML).not.toMatch(/NaN/);
    expect(within(await region('Practice exam history')).getAllByRole('row')).toHaveLength(2);
    expect(await region('Practice exam history')).not.toHaveTextContent(/partial practice exam/i);
  });

  it('says "Ready" in words when nothing is missing', async () => {
    handler = () => json(200, fresh({ readiness: { ready: true, missing: [] } }));
    renderDashboard();
    const readiness = await region('Exam readiness');
    expect(within(readiness).getByText('Ready')).toBeInTheDocument();
    expect(within(readiness).queryByText('Not yet')).not.toBeInTheDocument();
    expect(within(readiness).queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows the totals, the reviews due with a way to start, and the weakest objectives with "Practice now"', async () => {
    handler = () =>
      json(200, fresh({
        xp: 250, level: 2, nextLevelXp: 400, streak: 1, reviewsDue: 7,
        domains: DOMAIN_TITLES.map((title, i) => ({ id: i + 1, title, mastery: i === 0 ? 62 : 0 })),
        weakest: [
          { objective: '1.2', title: 'Summarize fundamental security concepts', mastery: 0 },
          { objective: '1.1', title: 'Compare and contrast various types of security controls', mastery: 50 },
        ],
      }));
    renderDashboard();
    const progress = await region('Your progress');
    expect(progress).toHaveTextContent('Level2');
    expect(progress).toHaveTextContent('XP250');
    expect(progress).toHaveTextContent('150 XP to level 3');
    expect(progress).toHaveTextContent('Streak1 day');
    expect(progress).not.toHaveTextContent('1 days');

    expect(await region('Reviews')).toHaveTextContent('7 cards are due today.');
    expect(within(await region('Mastery by domain')).getAllByRole('progressbar')[0]).toHaveAttribute('aria-valuenow', '62');

    const weakest = within(await region('Weakest objectives')).getAllByRole('listitem');
    expect(weakest).toHaveLength(2);
    expect(weakest[0]).toHaveTextContent('1.2 Summarize fundamental security concepts');
    expect(within(weakest[0]!).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    // Each link says which objective it is for.
    const links = screen.getAllByRole('link', { name: /Practice now/ });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/practice/1.2', '/practice/1.1']);
    expect(links[0]).toHaveAccessibleName('Practice now: objective 1.2');

    await userEvent.click(screen.getByRole('link', { name: 'Start review' }));
    expect(screen.getByText('review screen')).toBeInTheDocument();
  });

  it('an objective at 100% is "Mastered" in words and has no "Practice now", which would lead to an empty page', async () => {
    handler = () =>
      json(200, fresh({
        weakest: [
          { objective: '1.3', title: 'Explain the importance of change management processes', mastery: 99 },
          { objective: '1.1', title: 'Compare and contrast various types of security controls', mastery: 100 },
        ],
      }));
    renderDashboard();
    const [almost, mastered] = within(await region('Weakest objectives')).getAllByRole('listitem');
    expect(within(almost!).getByRole('link', { name: 'Practice now: objective 1.3' })).toHaveAttribute('href', '/practice/1.3');
    expect(almost).not.toHaveTextContent('Mastered');
    expect(within(mastered!).queryByRole('link')).not.toBeInTheDocument();
    expect(within(mastered!).getByText('Mastered')).toBeInTheDocument();
    expect(within(mastered!).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('says one card "is" due', async () => {
    handler = () => json(200, fresh({ reviewsDue: 1 }));
    renderDashboard();
    expect(await region('Reviews')).toHaveTextContent('1 card is due today.');
  });

  it('badges say in words which are earned, and when', async () => {
    const earnedAt = '2026-11-08T23:30:00.000Z';
    handler = () => json(200, fresh({ badges: BADGES.map((b) => (b.id === 'first-lesson' ? { ...b, earnedAt } : b)) }));
    // 23:30 UTC on the 8th is already the 9th in Tokyo: the date follows the learner's time zone.
    renderDashboard({ ...learner, timeZone: 'Asia/Tokyo' });
    const badges = await region('Badges');
    expect(badges).toHaveTextContent(`1 of ${BADGES.length} earned`);
    const [first, second] = within(badges).getAllByRole('listitem');
    expect(first).toHaveTextContent('First Lesson');
    expect(first).toHaveTextContent(`Earned ${formatInstant(earnedAt, 'Asia/Tokyo')}`);
    expect(formatInstant(earnedAt, 'Asia/Tokyo', { locale: 'en-GB' })).toBe('9 Nov 2026');
    expect(first).not.toHaveTextContent('Not earned yet');
    expect(first!.querySelector('time')).toHaveAttribute('datetime', earnedAt);
    expect(second).toHaveTextContent('Not earned yet');
  });

  it('a failed refresh keeps the numbers on screen, says so, and recovers on "Try again"', async () => {
    handler = () => json(200, fresh({ xp: 250, level: 2, nextLevelXp: 400 }));
    renderDashboard();
    expect(await region('Your progress')).toHaveTextContent('XP250');
    // The live region is on the page before it has anything to say: only its text changes.
    const live = screen.getByRole('status');
    expect(live).toBeEmptyDOMElement();

    handler = () => Promise.reject(new TypeError('Failed to fetch'));
    await act(() => client.refetchQueries({ queryKey: ['dashboard'] }));
    expect(await screen.findByText("Couldn't refresh your dashboard. What you see may be out of date.")).toBe(live);
    expect(await region('Your progress')).toHaveTextContent('XP250');

    handler = () => json(200, fresh({ xp: 300, level: 2, nextLevelXp: 400 }));
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('100 XP to level 3')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't refresh/)).not.toBeInTheDocument();
    expect(live).toBeInTheDocument();
    expect(live).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus(); // the button is gone; focus did not fall off the page
  });

  it('offline, a refresh that has to wait says that the numbers may be out of date, until it has happened', async () => {
    handler = () => json(200, fresh({ xp: 250, level: 2, nextLevelXp: 400 }));
    renderDashboard();
    expect(await region('Your progress')).toHaveTextContent('XP250');
    const live = screen.getByRole('status');

    act(() => onlineManager.setOnline(false));
    handler = () => json(200, fresh({ xp: 300, level: 2, nextLevelXp: 400 }));
    act(() => void client.invalidateQueries({ queryKey: ['dashboard'] }));
    await waitFor(() => expect(live).toHaveTextContent('You are offline. What you see may be out of date.'));
    expect(await region('Your progress')).toHaveTextContent('XP250');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

    act(() => onlineManager.setOnline(true));
    expect(await screen.findByText('100 XP to level 3')).toBeInTheDocument();
    expect(live).toBeEmptyDOMElement();
  });

  it('offline on the first visit, it says so instead of "Loading" without end', async () => {
    act(() => onlineManager.setOnline(false));
    renderDashboard();
    expect(await screen.findByText('You are offline: your dashboard will load when you are back online.')).toHaveAttribute('role', 'status');
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => onlineManager.setOnline(true));
    expect(await region('Exam readiness')).toBeInTheDocument();
  });

  it('a server error on the first load offers "Try again" and recovers', async () => {
    handler = () => json(500, { error: 'Internal error' });
    renderDashboard();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your dashboard.");
    expect(screen.queryByRole('region', { name: 'Exam readiness' })).not.toBeInTheDocument();

    handler = () => json(200, fresh());
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await region('Exam readiness')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
