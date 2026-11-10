import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, useQuery, type QueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Answer, Feedback, PublicQuestion } from '../../../../shared/types';
import { api } from '../../api/client';
import type { AssessmentResult, AssessmentView, DashboardMocks, MockHistoryEntry, PathDomain, PathResponse } from '../../api/types';
import { createQueryClient } from '../../queryClient';
import { holdPressClock } from '../../test/pressClock';
import { SETTLE_MS } from '../../ui/pressGuard';
import { REFRESH_DELAY_MS, RewardsBanner, RewardsContext, RewardsProvider, useRewards, type RewardsValue } from '../rewards/RewardsProvider';
import { ExamLobbyPage } from './ExamLobbyPage';
import { examSaves } from './examSaves';
import { ExamPage } from './ExamPage';
import { QuizPage } from './QuizPage';
import { ResultsView } from './ResultsView';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const OPTIONS = [
  { id: 'a', text: 'Alpha' },
  { id: 'b', text: 'Bravo' },
  { id: 'c', text: 'Charlie' },
  { id: 'd', text: 'Delta' },
];

/** A single-choice question; option "a" (Alpha) is the right one. */
const single = (n: number, objective = '1.1'): PublicQuestion => ({
  id: `q-${objective}-${String(n).padStart(3, '0')}`, objective, difficulty: 1, type: 'single',
  prompt: `Prompt number ${n}?`, options: OPTIONS,
});

const order: PublicQuestion = {
  id: 'q-1.2-050', objective: '1.2', difficulty: 2, type: 'order',
  prompt: 'Put the change steps in order.',
  items: [
    { id: 'c', text: 'Implement' },
    { id: 'a', text: 'Request' },
    { id: 'b', text: 'Approve' },
  ],
};

const multi: PublicQuestion = {
  id: 'q-1.2-060', objective: '1.2', difficulty: 2, type: 'multi',
  prompt: 'Which of these are physical controls? (Choose two.)',
  options: [
    { id: 'a', text: 'Bollards' },
    { id: 'b', text: 'Access policy' },
    { id: 'c', text: 'Door lock' },
    { id: 'd', text: 'Log review' },
  ],
};

const match: PublicQuestion = {
  id: 'q-1.2-070', objective: '1.2', difficulty: 2, type: 'match',
  prompt: 'Match each goal to its control.',
  left: [
    { id: 'l1', text: 'Confidentiality' },
    { id: 'l2', text: 'Integrity' },
  ],
  right: [
    { id: 'r1', text: 'Encryption' },
    { id: 'r2', text: 'Hashing' },
  ],
};

const pick = (choice: string): Answer => ({ type: 'single', choice });

const marked = (q: PublicQuestion, correct: boolean): Feedback =>
  q.type === 'order'
    ? { correct, fraction: correct ? 1 : 0, correctAnswer: { type: 'order', order: ['a', 'b', 'c'] }, explanation: 'Request comes first.' }
    : {
        correct, fraction: correct ? 1 : 0, correctAnswer: pick('a'),
        explanation: correct ? 'Alpha is right.' : 'Alpha was the answer.',
        why: { a: 'The right one.', b: 'Not this.', c: 'Nor this.', d: 'Nor that.' },
      };

const quiz = (count = 2, over: Partial<AssessmentView> = {}): AssessmentView => ({
  id: 12, kind: 'objective', scope: '1.1', partial: false,
  questions: Array.from({ length: count }, (_, i) => single(i + 1)),
  answers: {}, flags: [], feedback: {}, deadlineAt: null, submittedAt: null, serverNow: new Date().toISOString(),
  ...over,
});

const examQuestions = [single(1), single(2), single(3), single(4, '1.2'), order];
const [q1, q2, q3, q4] = examQuestions as [PublicQuestion, PublicQuestion, PublicQuestion, PublicQuestion];

const exam = (over: Partial<AssessmentView> = {}): AssessmentView => ({
  id: 30, kind: 'domain', scope: '1', partial: false,
  questions: examQuestions,
  answers: {}, flags: [], feedback: {},
  deadlineAt: new Date(Date.now() + 25 * 60_000).toISOString(), submittedAt: null, serverNow: new Date().toISOString(),
  ...over,
});

/** The finalized form of `open`: the first `right` questions answered correctly, the last `unanswered` left blank. */
function finished(open: AssessmentView, right: number, over: Partial<AssessmentResult> = {}, unanswered = 0): AssessmentView {
  const total = open.questions.length;
  const answers: Record<string, Answer> = {};
  const feedback: Record<string, Feedback> = {};
  open.questions.forEach((q, i) => {
    const ok = i < right;
    if (i < total - unanswered) answers[q.id] = q.type === 'order' ? { type: 'order', order: ['c', 'a', 'b'] } : pick(ok ? 'a' : 'b');
    feedback[q.id] = marked(q, ok);
  });
  const tally = (key: (q: PublicQuestion) => string) => {
    const out: Record<string, { correct: number; total: number }> = {};
    open.questions.forEach((q, i) => {
      const t = (out[key(q)] ??= { correct: 0, total: 0 });
      t.total++;
      if (i < right) t.correct++;
    });
    return out;
  };
  return {
    ...open, answers, feedback, submittedAt: '2026-11-10T12:30:00.000Z',
    result: {
      scorePct: Math.round((right / total) * 10000) / 100, passed: false,
      byDomain: tally((q) => q.objective.split('.')[0]!), byObjective: tally((q) => q.objective),
      xp: 0, newBadges: [], ...over,
    },
  };
}

const domain = (id: number, hasContent: boolean): PathDomain => ({
  id, title: `Domain ${id} title`, weight: 20, unlocked: id === 1, examPassed: false, hasContent, openExam: null,
  objectives: [1, 2].map((n) => ({
    id: `${id}.${n}`, title: `Objective ${id}.${n} title`, published: hasContent, lessonDone: false, quizPassed: false, mastery: 0,
  })),
});
const path = (withContent: number[] = [1]): PathResponse => ({ domains: [1, 2, 3, 4, 5].map((id) => domain(id, withContent.includes(id))) });

const PARTIAL_MOCK = { questions: 11, minutes: 11, partial: true };
const FULL_MOCK = { questions: 90, minutes: 90, partial: false };
const dashboard = (mockHistory: MockHistoryEntry[] = [], over: Partial<DashboardMocks> = {}) => ({
  xp: 120, level: 1, nextLevelXp: 500, streak: 2, mockHistory, openMock: null, mockSpec: PARTIAL_MOCK, ...over,
});

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handlers: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;
/** Every report that a screen makes to the rewards provider, which then deals with it as it does in the app. */
let reported: Mock<RewardsValue['report']>;

const keyOf = (url: unknown, init?: RequestInit) => `${init?.method ?? 'GET'} ${String(url)}`;
const calls = (key: string) => fetchMock.mock.calls.filter(([u, i]) => keyOf(u, i) === key);
const bodies = (key: string) => calls(key).map(([, i]) => JSON.parse(String(i.body)));
/** Every request that changes something, in the order it was sent. */
const writes = () => fetchMock.mock.calls.map(([u, i]) => keyOf(u, i)).filter((k) => !k.startsWith('GET'));

const SAVE = 'PUT /api/assessments/30/answers';
const SUBMIT = 'POST /api/assessments/30/submit';

beforeEach(() => {
  handlers = {
    'GET /api/path': () => json(200, path()),
    'GET /api/dashboard': () => json(200, dashboard()),
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const h = handlers[keyOf(url, init)];
    if (!h) throw new Error(`unexpected request ${keyOf(url, init)}`);
    return h(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  reported = vi.fn<RewardsValue['report']>();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The real rewards provider and its banner, with a note taken of each report on its way in. */
function Rewards({ children }: { children: ReactNode }) {
  return (
    <RewardsProvider>
      <RewardsBanner />
      <Noted>{children}</Noted>
    </RewardsProvider>
  );
}

function Noted({ children }: { children: ReactNode }) {
  const { report } = useRewards();
  const noting = useMemo<RewardsValue>(
    () => ({
      report(r) {
        reported(r);
        return report(r);
      },
    }),
    [report],
  );
  return <RewardsContext.Provider value={noting}>{children}</RewardsContext.Provider>;
}

/** Stands in for the app shell and the path map: screens that show data an assessment changes. */
function Observers() {
  useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('dashboard') });
  useQuery({ queryKey: ['path'], queryFn: () => api.get('path') });
  return null;
}

/** The screens under a key: "remount" takes the page on screen away and mounts a new one in the same update. */
function Screens() {
  const [mounts, setMounts] = useState(0);
  return (
    <>
      <button onClick={() => setMounts(mounts + 1)}>remount</button>
      <Routes key={mounts}>
        <Route path="/" element={<p>path screen</p>} />
        <Route path="/quiz/:id" element={<QuizPage />} />
        <Route path="/exam" element={<ExamLobbyPage />} />
        <Route path="/exam/:id" element={<ExamPage />} />
      </Routes>
    </>
  );
}

function renderAt(url: string, client: QueryClient = createQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <Observers />
      <Rewards>
        <MemoryRouter initialEntries={[url]}>
          <Link to="/">leave</Link>
          <Link to={url}>come back</Link>
          <Screens />
        </MemoryRouter>
      </Rewards>
    </QueryClientProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

// With fake timers Testing Library's `findBy…` and user-event would wait on a clock that does not move, so
// those tests use `fireEvent`, move the clock themselves and then read the page as it is.
const FAKED = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as const;
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
/** Lets requests that have been answered, and the updates they cause, finish without moving the clock. */
async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

const result = () => screen.getByRole('status', { name: 'Result' });
const heading = (name: string, level = 2) => screen.findByRole('heading', { level, name });
const nav = () => screen.getByRole('navigation', { name: 'Question navigator' });
const navButtons = () => within(nav()).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
const flagToggle = () => screen.getByRole('button', { name: 'Flag for review' });
const dialog = () => screen.getByRole('dialog', { name: 'Submit exam?' });
const button = (name: string) => screen.getByRole('button', { name });
const submission = () => screen.getByRole('status', { name: 'Submission' });
const assessmentReads = (id: number) => calls(`GET /api/assessments/${id}`).length;
const reviewItems = () => within(screen.getByRole('list', { name: 'Questions' })).getAllByRole('button');
/** Long enough for a read of the dashboard that a report had asked for to have been sent. */
const afterRefreshWait = () => new Promise((r) => setTimeout(r, REFRESH_DELAY_MS + 100));
/** Where the rewards provider shows a new badge or level. */
const rewardsBanner = () => screen.getByRole('status', { name: 'Rewards' });

describe('quiz', () => {
  it('quiz: Check is disabled until isComplete; shows feedback then Next; last question leads to results', async () => {
    const open = quiz(2);
    handlers['GET /api/assessments/12'] = () => json(200, open);
    handlers['PUT /api/assessments/12/answers'] = () => json(200, { feedback: marked(open.questions[0]!, true) });
    handlers['POST /api/assessments/12/submit'] = () => json(200, { result: finished(open, 2).result });
    renderAt('/quiz/12');

    await heading('Question 1 of 2');
    expect(screen.getByRole('heading', { level: 1, name: 'Objective 1.1 quiz' })).toBeInTheDocument();
    const check = screen.getByRole('button', { name: 'Check' });
    expect(check).toBeDisabled();
    expect(result()).toBeEmptyDOMElement();

    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    expect(check).toBeEnabled();
    await userEvent.click(check);

    expect(await within(result()).findByText('Alpha is right.')).toBeInTheDocument();
    expect(bodies('PUT /api/assessments/12/answers')).toEqual([{ questionId: 'q-1.1-001', answer: pick('a') }]);
    expect(screen.queryByRole('button', { name: 'Check' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Alpha' })).toBeDisabled();
    expect(screen.getByRole('progressbar', { name: 'Quiz progress' })).toHaveAttribute('aria-valuetext', '1 of 2 answered');

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await heading('Question 2 of 2')).toHaveFocus();
    // Nothing carries over from the question before.
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(result()).toBeEmptyDOMElement();

    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await within(result()).findByText('Alpha is right.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();

    handlers['GET /api/assessments/12'] = () => json(200, finished(open, 2, { passed: true, xp: 100 }));
    await userEvent.click(screen.getByRole('button', { name: 'See results' }));

    expect(await heading('Objective 1.1 quiz results', 1)).toHaveFocus();
    expect(calls('POST /api/assessments/12/submit')).toHaveLength(1);
    expect(screen.getByText('2 of 2 correct')).toBeInTheDocument();
  });

  it('quiz results: 8/10 shows Passed, 7/10 shows "Not yet" with Retake', async () => {
    handlers['GET /api/assessments/12'] = () => json(200, finished(quiz(10), 8, { passed: true, xp: 100, newBadges: ['first-quiz-pass'] }));
    const first = renderAt('/quiz/12');

    await heading('Objective 1.1 quiz results', 1);
    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.getByText('8 of 10 correct')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Score: 80%' })).toBeInTheDocument();
    expect(screen.getByText(/Pass mark: 80%/)).toBeInTheDocument();
    expect(screen.getByText('XP earned: 100')).toBeInTheDocument();
    expect(screen.queryByText('Not yet')).not.toBeInTheDocument();
    // Opened later, not finished just now: no celebration, and focus is left alone.
    expect(screen.queryByText('Quiz passed')).not.toBeInTheDocument();
    // What it earned, it earned then: nothing is reported for a result the learner has come back to.
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(2));
    expect(reported).not.toHaveBeenCalled();
    expect(rewardsBanner()).toBeEmptyDOMElement();
    first.unmount();

    handlers['GET /api/assessments/12'] = () => json(200, finished(quiz(10), 7));
    const started = deferred<Response>();
    handlers['GET /api/assessments/13'] = () => json(200, quiz(10, { id: 13 }));
    handlers['POST /api/assessments'] = () => started.promise;
    renderAt('/quiz/12');

    await heading('Objective 1.1 quiz results', 1);
    expect(screen.getByText('Not yet')).toBeInTheDocument();
    expect(screen.getByText('7 of 10 correct')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Score: 70%' })).toBeInTheDocument();
    expect(screen.queryByText('Passed')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to path' })).toHaveAttribute('href', '/');

    // A double click starts one new quiz.
    await userEvent.dblClick(screen.getByRole('button', { name: 'Retake' }));
    expect(bodies('POST /api/assessments')).toEqual([{ kind: 'objective', scope: '1.1' }]);
    started.resolve(json(201, { id: 13 }));
    await heading('Question 1 of 10');
    expect(calls('POST /api/assessments')).toHaveLength(1);
  });

  it('celebrates a pass that happened just now and refreshes the path and the header', async () => {
    const open = quiz(1, { answers: { 'q-1.1-001': pick('a') }, feedback: { 'q-1.1-001': marked(single(1), true) } });
    handlers['GET /api/assessments/12'] = () => json(200, open);
    handlers['POST /api/assessments/12/submit'] = () => json(200, { result: finished(open, 1).result });
    renderAt('/quiz/12');

    // Every question was answered before the page was reloaded: the last one is shown, already marked.
    await heading('Question 1 of 1');
    expect(within(result()).getByText('Alpha is right.')).toBeInTheDocument();
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(1));
    expect(calls('GET /api/path')).toHaveLength(1);

    handlers['GET /api/assessments/12'] = () => json(200, finished(open, 1, { passed: true, xp: 100 }));
    await userEvent.click(screen.getByRole('button', { name: 'See results' }));

    const title = await heading('Objective 1.1 quiz results', 1);
    const banner = screen.getByRole('group', { name: 'Quiz passed' });
    expect(banner).toHaveTextContent('+100 XP');
    // It is announced with the heading that takes focus, not by a live region that arrives with its text.
    expect(title).toHaveFocus();
    expect(title).toHaveAccessibleDescription(/Quiz passed\s*Objective 1\.1\s*\+100 XP/);
    expect(banner.closest('[role="status"]')).toBeNull();
    // The result is reported to the rewards provider once, and the header's numbers are read once for it.
    expect(reported.mock.calls).toEqual([[{ xp: 100, newBadges: [] }]]);
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(2));
    await waitFor(() => expect(calls('GET /api/path')).toHaveLength(2));
    await afterRefreshWait();
    expect(calls('GET /api/dashboard')).toHaveLength(2);

    await userEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Quiz passed')).not.toBeInTheDocument();
    expect(title).toHaveFocus();
  });

  it('a passed quiz that also earns a badge and a level shows its own celebration first, then the badge, then the level', async () => {
    const open = quiz(1, { answers: { 'q-1.1-001': pick('a') }, feedback: { 'q-1.1-001': marked(single(1), true) } });
    const done = finished(open, 1, { passed: true, xp: 130, newBadges: ['first-quiz-pass'] });
    const badges = [{ id: 'first-quiz-pass', title: 'Quiz Passer', description: 'Pass an objective quiz.', earnedAt: null }];
    let totals = { ...dashboard(), xp: 390, level: 2, nextLevelXp: 400, badges };
    handlers['GET /api/dashboard'] = () => json(200, totals);
    handlers['GET /api/assessments/12'] = () => json(200, open);
    handlers['POST /api/assessments/12/submit'] = () => json(200, { result: done.result });
    const client = createQueryClient();
    renderAt('/quiz/12', client);
    await heading('Question 1 of 1');
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(1));

    totals = { ...totals, xp: 520, level: 3, nextLevelXp: 900 };
    handlers['GET /api/assessments/12'] = () => json(200, done);
    await userEvent.click(button('See results'));
    const title = await heading('Objective 1.1 quiz results', 1);
    expect(title).toHaveFocus();
    const own = screen.getByRole('group', { name: 'Quiz passed' });
    expect(own).toHaveTextContent('+130 XP');
    expect(reported.mock.calls).toEqual([[{ xp: 130, newBadges: ['first-quiz-pass'] }]]);

    // The header's numbers are read once; the badge and the new level are known, and wait.
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(2));
    await waitFor(() => expect(client.getQueryData<{ level: number }>(['dashboard'])?.level).toBe(3));
    expect(rewardsBanner()).toBeEmptyDOMElement();
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(1);

    await userEvent.click(within(own).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Quiz passed')).not.toBeInTheDocument();
    expect(rewardsBanner()).toHaveTextContent('Badge earned');
    expect(rewardsBanner()).toHaveTextContent('Quiz Passer');
    // Focus stays with the results: the banner does not take it.
    expect(title).toHaveFocus();
    await userEvent.click(within(rewardsBanner()).getByRole('button', { name: 'Dismiss' }));
    expect(rewardsBanner()).toHaveTextContent('Level up');
    expect(rewardsBanner()).toHaveTextContent('Level 3');
    await userEvent.click(within(rewardsBanner()).getByRole('button', { name: 'Dismiss' }));
    expect(rewardsBanner()).toBeEmptyDOMElement();
    expect(calls('GET /api/dashboard')).toHaveLength(2);
  });

  it('celebrates a pass that reaches the page while it is reading the quiz again, before that read has been handled', async () => {
    const client = createQueryClient();
    const open = quiz(1, { answers: { 'q-1.1-001': pick('a') }, feedback: { 'q-1.1-001': marked(single(1), true) } });
    const done = finished(open, 1, { passed: true, xp: 100 });
    handlers['GET /api/assessments/12'] = () => json(200, open);
    handlers['POST /api/assessments/12/submit'] = () => json(200, { result: done.result });
    renderAt('/quiz/12', client);
    await heading('Question 1 of 1');

    const read = deferred<Response>();
    handlers['GET /api/assessments/12'] = () => read.promise;
    await userEvent.click(button('See results'));
    await waitFor(() => expect(assessmentReads(12)).toBe(2));
    // The result is on screen before the read that was asked for has come back: whichever of the two the
    // page learns of first, the quiz was finished in this visit.
    act(() => {
      client.setQueryData(['assessment', '12'], { view: done, clockOffsetMs: 0 });
    });
    expect(await heading('Objective 1.1 quiz results', 1)).toHaveFocus();
    expect(screen.getByText('Quiz passed')).toBeInTheDocument();

    read.resolve(json(200, done));
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(2));
    expect(screen.getByText('Quiz passed')).toBeInTheDocument();
  });

  it('a double click on Check sends one answer', async () => {
    const open = quiz(2);
    const answer = deferred<Response>();
    handlers['GET /api/assessments/12'] = () => json(200, open);
    handlers['PUT /api/assessments/12/answers'] = () => answer.promise;
    renderAt('/quiz/12');
    await heading('Question 1 of 2');
    await userEvent.click(screen.getByRole('radio', { name: 'Bravo' }));
    await userEvent.dblClick(screen.getByRole('button', { name: 'Check' }));
    expect(calls('PUT /api/assessments/12/answers')).toHaveLength(1);

    answer.resolve(json(200, { feedback: marked(open.questions[0]!, false) }));
    expect(await within(result()).findByText('Alpha was the answer.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await heading('Question 2 of 2')).toBeInTheDocument();
  });

  // Ordinary presses, sent straight after the button under them has changed. Time stands still unless the
  // test moves it, so each press is inside or outside the settle window exactly as written.
  it('a press straight after the button changed is ignored: Check does not run into Next or "See results", Next does not grade an untouched order question', async () => {
    const clock = holdPressClock();
    const open = quiz(2, { questions: [single(1), order] });
    const done = finished(open, 1);
    handlers['GET /api/assessments/12'] = () => json(200, open);
    handlers['PUT /api/assessments/12/answers'] = (_url, init) =>
      json(200, { feedback: marked(JSON.parse(String(init!.body)).questionId === order.id ? order : single(1), true) });
    handlers['POST /api/assessments/12/submit'] = () => json(200, { result: done.result });
    renderAt('/quiz/12');
    await heading('Question 1 of 2');
    clock.advance(SETTLE_MS);
    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    await userEvent.click(button('Check'));

    // "Next" is now where "Check" was.
    const next = await screen.findByRole('button', { name: 'Next' });
    await userEvent.click(next);
    clock.advance(SETTLE_MS - 1);
    await userEvent.click(next);
    expect(screen.getByRole('heading', { level: 2, name: 'Question 1 of 2' })).toBeInTheDocument();
    expect(within(result()).getByText('Alpha is right.')).toBeInTheDocument();
    expect(next).toBeEnabled();

    clock.advance(1);
    await userEvent.click(next);
    await heading('Question 2 of 2');
    // The order question is complete as it was served: its Check is live, and must not be pressed unseen.
    expect(button('Check')).toBeEnabled();
    await userEvent.click(button('Check'));
    clock.advance(SETTLE_MS - 1);
    await userEvent.click(button('Check'));
    expect(calls('PUT /api/assessments/12/answers')).toHaveLength(1);
    expect(result()).toBeEmptyDOMElement();

    clock.advance(1);
    await userEvent.click(button('Check'));
    expect(await within(result()).findByText('Request comes first.')).toBeInTheDocument();
    expect(calls('PUT /api/assessments/12/answers')).toHaveLength(2);

    // On the last question "See results" takes the place of "Check": the feedback is not skipped either.
    const finish = screen.getByRole('button', { name: 'See results' });
    await userEvent.click(finish);
    clock.advance(SETTLE_MS - 1);
    await userEvent.click(finish);
    expect(calls('POST /api/assessments/12/submit')).toHaveLength(0);

    clock.advance(1);
    handlers['GET /api/assessments/12'] = () => json(200, done);
    handlers['POST /api/assessments'] = () => json(201, { id: 13 });
    handlers['GET /api/assessments/13'] = () => json(200, quiz(2, { id: 13 }));
    await userEvent.click(finish);
    await heading('Objective 1.1 quiz results', 1);
    expect(calls('POST /api/assessments/12/submit')).toHaveLength(1);

    // A press that arrives with the results does not start the quiz again.
    await userEvent.click(button('Retake'));
    expect(calls('POST /api/assessments')).toHaveLength(0);
    clock.advance(SETTLE_MS);
    await userEvent.click(button('Retake'));
    await heading('Question 1 of 2');
    expect(calls('POST /api/assessments')).toHaveLength(1);
  });

  it('a press that is handled after the answer came back, and before the page has shown it, sends nothing more', async () => {
    const clock = holdPressClock();
    const open = quiz(1);
    const done = finished(open, 1);
    const answer = deferred<Response>();
    const submitted = deferred<Response>();
    handlers['GET /api/assessments/12'] = () => json(200, open);
    handlers['PUT /api/assessments/12/answers'] = () => answer.promise;
    handlers['POST /api/assessments/12/submit'] = () => submitted.promise;
    renderAt('/quiz/12');
    await heading('Question 1 of 1');
    clock.advance(SETTLE_MS);
    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    const main = button('Check');
    await userEvent.click(main);
    expect(calls('PUT /api/assessments/12/answers')).toHaveLength(1);

    // Inside one `act` nothing is rendered until it ends: the response is handled, and the button on
    // screen is still "Check", as in the moment before React shows the feedback.
    await act(async () => {
      answer.resolve(json(200, { feedback: marked(open.questions[0]!, true) }));
      await new Promise((r) => setTimeout(r, 20));
      fireEvent.click(main);
      fireEvent.click(main);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(calls('PUT /api/assessments/12/answers')).toHaveLength(1);
    expect(within(result()).getByText('Alpha is right.')).toBeInTheDocument();

    // The same for "See results": the quiz is submitted once.
    clock.advance(SETTLE_MS);
    await userEvent.click(button('See results'));
    expect(calls('POST /api/assessments/12/submit')).toHaveLength(1);
    handlers['GET /api/assessments/12'] = () => json(200, done);
    await act(async () => {
      submitted.resolve(json(200, { result: done.result }));
      await new Promise((r) => setTimeout(r, 20));
      fireEvent.click(main);
      fireEvent.click(main);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(calls('POST /api/assessments/12/submit')).toHaveLength(1);
    expect(assessmentReads(12)).toBe(2);
    await heading('Objective 1.1 quiz results', 1);
  });

  it('shows what the server already holds when a question was answered elsewhere (409), without an error', async () => {
    const open = quiz(2);
    handlers['GET /api/assessments/12'] = () => json(200, open);
    handlers['PUT /api/assessments/12/answers'] = () => json(409, { error: 'This question was already answered' });
    renderAt('/quiz/12');
    await heading('Question 1 of 2');
    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));

    // The other tab answered "Bravo" first; that answer stands.
    handlers['GET /api/assessments/12'] = () =>
      json(200, { ...open, answers: { 'q-1.1-001': pick('b') }, feedback: { 'q-1.1-001': marked(open.questions[0]!, false) } });
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await within(result()).findByText('Alpha was the answer.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Bravo' })).toBeChecked();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('submits the served order when an order question is left untouched', async () => {
    handlers['GET /api/assessments/12'] = () => json(200, quiz(1, { questions: [order] }));
    handlers['PUT /api/assessments/12/answers'] = () => json(200, { feedback: marked(order, false) });
    renderAt('/quiz/12');
    await heading('Question 1 of 1');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await within(result()).findByText('Request comes first.')).toBeInTheDocument();
    expect(bodies('PUT /api/assessments/12/answers')).toEqual([{ questionId: 'q-1.2-050', answer: { type: 'order', order: ['c', 'a', 'b'] } }]);
  });

  it('keeps the chosen answer and offers a retry when the answer cannot be sent', async () => {
    const open = quiz(2);
    handlers['GET /api/assessments/12'] = () => json(200, open);
    handlers['PUT /api/assessments/12/answers'] = () => {
      throw new TypeError('Failed to fetch');
    };
    renderAt('/quiz/12');
    await heading('Question 1 of 2');
    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send your answer. It has not been marked yet.");
    expect(screen.getByRole('radio', { name: 'Alpha' })).toBeChecked();

    handlers['PUT /api/assessments/12/answers'] = () => json(200, { feedback: marked(open.questions[0]!, true) });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await within(result()).findByText('Alpha is right.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('resumes at the first unanswered question, and sends an exam opened as a quiz to the exam screen', async () => {
    const open = quiz(3);
    handlers['GET /api/assessments/12'] = () =>
      json(200, { ...open, answers: { 'q-1.1-001': pick('a') }, feedback: { 'q-1.1-001': marked(open.questions[0]!, true) } });
    const first = renderAt('/quiz/12');
    await heading('Question 2 of 3');
    expect(screen.getByRole('progressbar', { name: 'Quiz progress' })).toHaveAttribute('aria-valuetext', '1 of 3 answered');
    first.unmount();

    handlers['GET /api/assessments/30'] = () => json(200, exam());
    renderAt('/quiz/30');
    expect(await heading('Domain 1 exam', 1)).toBeInTheDocument();
  });

  it.each([
    [404, "This quiz isn't available."],
    [500, "Couldn't load this quiz."],
  ])('says so when the quiz cannot be loaded (%i)', async (status, text) => {
    handlers['GET /api/assessments/12'] = () => json(status, { error: 'Assessment not found' });
    renderAt('/quiz/12');
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('link', { name: 'Back to path' })).toHaveAttribute('href', '/');
  });
});

describe('exam', () => {
  it('exam: selecting an answer enqueues a PUT; navigator marks it answered', async () => {
    handlers['GET /api/assessments/30'] = () => json(200, exam());
    handlers[SAVE] = () => json(200, { saved: true });
    renderAt('/exam/30');

    await heading('Question 1 of 5');
    expect(screen.getByRole('heading', { level: 1, name: 'Domain 1 exam' })).toBeInTheDocument();
    expect(navButtons()).toEqual([
      'Question 1, unanswered', 'Question 2, unanswered', 'Question 3, unanswered', 'Question 4, unanswered', 'Question 5, unanswered',
    ]);
    expect(within(nav()).getByRole('button', { name: 'Question 1, unanswered' })).toHaveAttribute('aria-current', 'true');
    expect(within(nav()).getByText('0 of 5 answered, 0 flagged')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Charlie' }));

    await waitFor(() => expect(bodies(SAVE)).toEqual([{ questionId: 'q-1.1-001', answer: pick('c') }]));
    expect(screen.getByRole('radio', { name: 'Charlie' })).toBeChecked();
    expect(within(nav()).getByRole('button', { name: 'Question 1, answered' })).toHaveAttribute('aria-current', 'true');
    expect(within(nav()).getByText('1 of 5 answered, 0 flagged')).toBeInTheDocument();
    // No marking before the exam is submitted.
    expect(result()).toBeEmptyDOMElement();

    // Changing the answer saves again, for the same question.
    await userEvent.click(screen.getByRole('radio', { name: 'Delta' }));
    await waitFor(() => expect(bodies(SAVE)).toHaveLength(2));
    expect(bodies(SAVE)[1]).toEqual({ questionId: 'q-1.1-001', answer: pick('d') });

    await userEvent.click(within(nav()).getByRole('button', { name: 'Question 3, unanswered' }));
    expect(await heading('Question 3 of 5')).toHaveFocus();
    expect(within(nav()).getByRole('button', { name: 'Question 3, unanswered' })).toHaveAttribute('aria-current', 'true');
    expect(within(nav()).getByRole('button', { name: 'Question 1, answered' })).not.toHaveAttribute('aria-current');
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await heading('Question 2 of 5')).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await heading('Question 3 of 5')).toHaveFocus();
  });

  // jsdom lays nothing out, so this can only hold the rule that keeps the layout in the window: below the
  // two-column width the one column may shrink under its content (a match menu is as wide as its longest
  // answer, and an `auto` column would grow to it and push the page sideways on a phone).
  it('exam: the question column cannot be made wider than the screen by what is in it', async () => {
    handlers['GET /api/assessments/30'] = () => json(200, exam());
    renderAt('/exam/30');
    await heading('Question 1 of 5');
    const columns = nav().parentElement!;
    expect(columns).toHaveClass('grid', 'grid-cols-[minmax(0,1fr)]', 'lg:grid-cols-[minmax(0,1fr)_18rem]');
  });

  it('exam: flag toggles and shows in the navigator', async () => {
    handlers['GET /api/assessments/30'] = () => json(200, exam());
    handlers[SAVE] = () => json(200, { saved: true });
    renderAt('/exam/30');
    await heading('Question 1 of 5');
    expect(flagToggle()).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(flagToggle());
    expect(flagToggle()).toHaveAttribute('aria-pressed', 'true');
    expect(within(nav()).getByRole('button', { name: 'Question 1, unanswered, flagged' })).toBeInTheDocument();
    expect(within(nav()).getByText('0 of 5 answered, 1 flagged')).toBeInTheDocument();
    await waitFor(() => expect(bodies(SAVE)).toEqual([{ questionId: 'q-1.1-001', flagged: true }]));

    // An answer and a flag for the same question that wait behind a slow save are both sent: neither
    // replaces the other.
    const slow = deferred<Response>();
    handlers[SAVE] = () => slow.promise;
    await userEvent.click(within(nav()).getByRole('button', { name: 'Question 2, unanswered' }));
    await userEvent.click(flagToggle());
    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    expect(within(nav()).getByRole('button', { name: 'Question 2, answered, flagged' })).toBeInTheDocument();
    await userEvent.click(flagToggle());
    expect(flagToggle()).toHaveAttribute('aria-pressed', 'false');
    expect(within(nav()).getByRole('button', { name: 'Question 2, answered' })).toBeInTheDocument();
    expect(bodies(SAVE)).toHaveLength(2);

    handlers[SAVE] = () => json(200, { saved: true });
    slow.resolve(json(200, { saved: true }));
    await waitFor(() =>
      expect(bodies(SAVE)).toEqual([
        { questionId: 'q-1.1-001', flagged: true },
        { questionId: 'q-1.1-002', flagged: true },
        { questionId: 'q-1.1-002', answer: pick('a') },
        { questionId: 'q-1.1-002', flagged: false },
      ]),
    );
  });

  it('exam: reload restores answers and flags from the API', async () => {
    handlers['GET /api/assessments/30'] = () =>
      json(200, exam({ answers: { [q1.id]: pick('b'), [q3.id]: pick('d') }, flags: [q2.id, q3.id] }));
    renderAt('/exam/30');

    // Opens on the first question that has no answer yet.
    await heading('Question 2 of 5');
    expect(navButtons()).toEqual([
      'Question 1, answered', 'Question 2, unanswered, flagged', 'Question 3, answered, flagged', 'Question 4, unanswered', 'Question 5, unanswered',
    ]);
    expect(flagToggle()).toHaveAttribute('aria-pressed', 'true');
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();

    await userEvent.click(within(nav()).getByRole('button', { name: 'Question 1, answered' }));
    await heading('Question 1 of 5');
    expect(screen.getByRole('radio', { name: 'Bravo' })).toBeChecked();
    expect(flagToggle()).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(within(nav()).getByRole('button', { name: 'Question 3, answered, flagged' }));
    await heading('Question 3 of 5');
    expect(screen.getByRole('radio', { name: 'Delta' })).toBeChecked();
    expect(flagToggle()).toHaveAttribute('aria-pressed', 'true');
    expect(writes()).toEqual([]);
  });

  it('exam: timer shows mm:ss from deadlineAt, announces at 5:00 and 1:00 once each, and auto-submits at 0 after flushing saves', async () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    // This device's clock is three hours behind the server's: only the server's time may count.
    vi.setSystemTime(new Date('2026-11-10T09:00:00.000Z'));
    const serverNow = Date.parse('2026-11-10T12:00:00.000Z');
    const open = exam({ serverNow: new Date(serverNow).toISOString(), deadlineAt: new Date(serverNow + 6 * 60_000).toISOString() });
    const done = finished(open, 1, { xp: 15, newBadges: ['streak-3'] }, 4);
    handlers['GET /api/assessments/30'] = () => json(200, open);
    renderAt('/exam/30');
    await settle();

    const clock = screen.getByRole('timer', { name: 'Time left' });
    expect(clock).toHaveTextContent('06:00');
    expect(clock).toHaveClass('font-mono');
    expect(screen.queryByText('approximate')).not.toBeInTheDocument();
    // The ticking clock is not announced; a separate polite region carries the two warnings.
    expect(clock.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    const alerts = screen.getByRole('status', { name: 'Time alerts' });
    const announced: string[] = [];
    const observer = new MutationObserver(() => {
      if (alerts.textContent) announced.push(alerts.textContent);
    });
    observer.observe(alerts, { childList: true, characterData: true, subtree: true });

    await advance(59_000);
    expect(clock).toHaveTextContent('05:01');
    expect(clock).not.toHaveClass('text-warn');
    expect(screen.queryByText('Low time')).not.toBeInTheDocument();
    expect(alerts).toBeEmptyDOMElement();

    await advance(1_000);
    expect(clock).toHaveTextContent('05:00');
    expect(clock).toHaveClass('text-warn');
    // Not by colour alone.
    expect(screen.getByText('Low time')).toBeInTheDocument();
    expect(alerts).toHaveTextContent('5 minutes remaining');
    // The warning does not stay in the live region to be read again minutes later.
    await advance(5_000);
    expect(alerts).toBeEmptyDOMElement();

    await advance(4 * 60_000 - 6_000);
    expect(clock).toHaveTextContent('01:01');
    expect(alerts).toBeEmptyDOMElement();
    await advance(1_000);
    expect(clock).toHaveTextContent('01:00');
    expect(alerts).toHaveTextContent('1 minute remaining');

    // An answer whose save is still on its way when the time runs out.
    const save = deferred<Response>();
    handlers[SAVE] = () => save.promise;
    handlers[SUBMIT] = () => json(200, { result: done.result });
    const alpha = screen.getByRole('radio', { name: 'Alpha' });
    fireEvent.click(alpha);
    alpha.focus();
    await advance(60_000);

    expect(clock).toHaveTextContent('00:00');
    expect(screen.getByText('Time is up')).toBeInTheDocument();
    expect(alpha).toBeDisabled();
    // The focused control was switched off: focus goes to the line that says why.
    expect(submission()).toHaveTextContent('Time is up. Saving your answers…');
    expect(submission()).toHaveFocus();
    expect(calls(SAVE)).toHaveLength(1);
    expect(calls(SUBMIT)).toHaveLength(0);

    handlers['GET /api/assessments/30'] = () => json(200, done);
    save.resolve(json(200, { saved: true }));
    await settle();

    expect(writes()).toEqual([SAVE, SUBMIT]);
    expect(screen.getByRole('heading', { level: 1, name: 'Domain 1 exam results' })).toBeInTheDocument();
    // The exam that ended with its time is reported like one that was submitted by hand: once.
    expect(reported.mock.calls).toEqual([[{ xp: 15, newBadges: ['streak-3'] }]]);
    expect(announced).toEqual(['5 minutes remaining', '1 minute remaining']);
    // The server's time came with the exam itself: nothing else was asked for it.
    expect(calls('GET /api/health')).toHaveLength(0);
    observer.disconnect();
  });

  it.each([
    ['three hours fast', 3 * 3_600_000],
    ['three hours slow', -3 * 3_600_000],
    ['forty seconds fast', 40_000],
  ])('shows the time left on the server\'s clock when the device clock is %s, and submits when the server\'s time is up', async (_name, skew) => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    const serverNow = Date.parse('2026-11-10T12:00:00.000Z');
    vi.setSystemTime(new Date(serverNow + skew));
    const open = exam({ serverNow: new Date(serverNow).toISOString(), deadlineAt: new Date(serverNow + 90_000).toISOString() });
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SUBMIT] = () => json(200, { result: finished(open, 0).result });
    renderAt('/exam/30');
    await settle();
    expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent('01:30');

    await advance(89_000);
    expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent('00:01');
    expect(calls(SUBMIT)).toHaveLength(0);
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 0));
    await advance(1_000);
    await settle();
    expect(calls(SUBMIT)).toHaveLength(1);
  });

  it.each([
    ['missing', undefined],
    ['not a date', 'soon'],
  ])('never submits on the device clock alone: with the server\'s time %s the countdown is approximate and at zero the server is asked', async (_name, serverNow) => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    vi.setSystemTime(new Date('2026-11-10T12:00:00.000Z'));
    // By this device's clock two seconds are left; nothing says that the clock is right.
    const open = { ...exam({ deadlineAt: new Date(Date.now() + 2_000).toISOString() }), serverNow } as AssessmentView;
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SAVE] = () => json(200, { saved: true });
    renderAt('/exam/30');
    await settle();
    expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent('00:02');
    expect(screen.getByText('approximate')).toBeInTheDocument();
    expect(assessmentReads(30)).toBe(1);

    await advance(2_000);
    await settle();
    // Not submitted and not locked: the server, which keeps the real time, was asked instead.
    expect(writes()).toEqual([]);
    expect(assessmentReads(30)).toBe(2);
    expect(screen.queryByText('Time is up')).not.toBeInTheDocument();
    expect(screen.getByText('Checking the time…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    await settle();
    expect(screen.getByRole('radio', { name: 'Alpha' })).toBeChecked();
    expect(writes()).toEqual([SAVE]);

    // The server closes the exam at its own deadline; the next look finds the results.
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 1, {}, 4));
    await advance(15_000);
    await settle();
    expect(assessmentReads(30)).toBe(3);
    expect(screen.getByRole('heading', { level: 1, name: 'Domain 1 exam results' })).toBeInTheDocument();
    expect(writes()).toEqual([SAVE]);
  });

  it('announces a mark that a slow tick jumped past, in words that are true, and one that was passed before the page opened', async () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    vi.setSystemTime(new Date('2026-11-10T12:00:00.000Z'));
    const open = exam({ serverNow: new Date().toISOString(), deadlineAt: new Date(Date.now() + 310_000).toISOString() });
    handlers['GET /api/assessments/30'] = () => json(200, open);
    const first = renderAt('/exam/30');
    await settle();
    const alerts = () => screen.getByRole('status', { name: 'Time alerts' });
    expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent('05:10');
    expect(alerts()).toBeEmptyDOMElement();

    // The tab was asleep: the next tick comes 70 seconds late, at 4:00.
    vi.setSystemTime(new Date(Date.now() + 69_000));
    await advance(1_000);
    expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent('04:00');
    expect(alerts()).toHaveTextContent('Less than 5 minutes remaining');
    await advance(5_000);
    expect(alerts()).toBeEmptyDOMElement();
    first.unmount();

    // Opened with 30 seconds left: one warning, for the mark that matters.
    handlers['GET /api/assessments/30'] = () => json(200, exam({ serverNow: new Date().toISOString(), deadlineAt: new Date(Date.now() + 30_000).toISOString() }));
    renderAt('/exam/30');
    await settle();
    expect(alerts()).toHaveTextContent('Less than 1 minute remaining');
  });

  it('exam: submit dialog states "3 unanswered, 1 flagged" and submits only on confirm', async () => {
    const open = exam({ answers: { [q1.id]: pick('a'), [q2.id]: pick('b') }, flags: [q4.id] });
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SUBMIT] = () => json(200, { result: finished(open, 1).result });
    renderAt('/exam/30');
    await heading('Question 3 of 5');
    const submit = screen.getByRole('button', { name: 'Submit exam' });

    await userEvent.click(submit);
    expect(dialog()).toHaveAttribute('aria-modal', 'true');
    expect(dialog()).toHaveAccessibleDescription(/3 unanswered, 1 flagged/);
    const keep = within(dialog()).getByRole('button', { name: 'Keep working' });
    const confirm = within(dialog()).getByRole('button', { name: 'Submit now' });
    expect(keep).toHaveFocus();

    // Focus stays inside the dialog.
    await userEvent.tab();
    expect(confirm).toHaveFocus();
    await userEvent.tab();
    expect(keep).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(confirm).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(submit).toHaveFocus();

    await userEvent.click(submit);
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Keep working' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(submit).toHaveFocus();
    expect(calls(SUBMIT)).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 2, name: 'Question 3 of 5' })).toBeInTheDocument();

    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 1));
    await userEvent.keyboard('{Enter}');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));

    expect(await heading('Domain 1 exam results', 1)).toHaveFocus();
    expect(calls(SUBMIT)).toHaveLength(1);
    expect(screen.getByText('Not yet')).toBeInTheDocument();
    // Nothing was earned, and that is reported as it is. The exam history has changed all the same: the
    // totals are read again once.
    expect(reported.mock.calls).toEqual([[{ xp: 0, newBadges: [] }]]);
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(2));
    expect(calls('GET /api/path')).toHaveLength(2);
    await afterRefreshWait();
    expect(calls('GET /api/dashboard')).toHaveLength(2);
  });

  it('exam: while saves are failing the SaveIndicator reads "Not saved yet" and Submit waits for flush', async () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    const open = exam();
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SAVE] = () => {
      throw new TypeError('Failed to fetch');
    };
    handlers[SUBMIT] = () => json(200, { result: finished(open, 0).result });
    renderAt('/exam/30');
    await settle();

    fireEvent.click(screen.getByRole('radio', { name: 'Bravo' }));
    await settle();
    const indicator = screen.getByText('Not saved yet. Retrying…');
    expect(indicator).toHaveAttribute('role', 'status');
    expect(screen.getByRole('radio', { name: 'Bravo' })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));
    await settle();
    expect(screen.getByText('Saving your answers before submitting…')).toBeInTheDocument();
    expect(calls(SUBMIT)).toHaveLength(0);

    // The connection is back: the retry saves the answer once, and only then is the exam submitted.
    handlers[SAVE] = () => json(200, { saved: true });
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 0));
    await advance(1_000);
    await settle();

    expect(writes()).toEqual([SAVE, SAVE, SUBMIT]);
    expect(bodies(SAVE)).toEqual([
      { questionId: 'q-1.1-001', answer: pick('b') },
      { questionId: 'q-1.1-001', answer: pick('b') },
    ]);
    expect(screen.getByRole('heading', { level: 1, name: 'Domain 1 exam results' })).toBeInTheDocument();
  });

  it('exam: a 409 on save (deadline passed) loads the finalized results', async () => {
    const open = exam({ answers: { [q1.id]: pick('a') } });
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SAVE] = () => json(409, { error: 'This assessment is already submitted' });
    renderAt('/exam/30');
    await heading('Question 2 of 5');

    // The server closed the exam at its deadline and scored what it had saved.
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 1, { xp: 12, newBadges: ['hundred-correct'] }, 4));
    await userEvent.click(screen.getByRole('radio', { name: 'Bravo' }));

    expect(await heading('Domain 1 exam results', 1)).toBeInTheDocument();
    expect(screen.getByText('1 of 5 correct')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(writes()).toEqual([SAVE]);
    // The server closed it, not this page; its result is news here all the same, and is reported once.
    expect(reported.mock.calls).toEqual([[{ xp: 12, newBadges: ['hundred-correct'] }]]);
  });

  it('shows results that were there before this page was opened without reporting or celebrating them, and reads the totals once', async () => {
    // Closed by the server yesterday, when its time ran out.
    const old = { ...finished(exam(), 4, { passed: true, xp: 340, newBadges: ['domain-1-complete'] }), deadlineAt: '2026-11-09T12:25:00.000Z', submittedAt: '2026-11-09T12:31:00.000Z' };
    handlers['GET /api/assessments/30'] = () => json(200, old);
    renderAt('/exam/30');
    await heading('Domain 1 exam results', 1);
    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit exam' })).not.toBeInTheDocument();
    // Not finished just now, so not celebrated; the totals are read again all the same, once.
    expect(screen.queryByText('Exam passed')).not.toBeInTheDocument();
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(2));
    await waitFor(() => expect(calls('GET /api/path')).toHaveLength(2));
    expect(writes()).toEqual([]);

    // Looking at the same result again changes nothing, so nothing is refreshed.
    await userEvent.click(screen.getByRole('link', { name: 'leave' }));
    await userEvent.click(screen.getByRole('link', { name: 'come back' }));
    await heading('Domain 1 exam results', 1);
    await afterRefreshWait();
    expect(calls('GET /api/dashboard')).toHaveLength(2);
    // What it earned, it earned before this page was opened: nothing is reported.
    expect(reported).not.toHaveBeenCalled();
    expect(rewardsBanner()).toBeEmptyDOMElement();
  });

  it('does not report an exam that the learner submitted elsewhere, before its time was up', async () => {
    // Submitted a moment ago on another device, with ten minutes left: it was reported there.
    const now = Date.now();
    const elsewhere = {
      ...finished(exam(), 4, { passed: true, xp: 340, newBadges: ['domain-1-complete'] }),
      deadlineAt: new Date(now + 10 * 60_000).toISOString(), submittedAt: new Date(now).toISOString(), serverNow: new Date(now).toISOString(),
    };
    handlers['GET /api/assessments/30'] = () => json(200, elsewhere);
    renderAt('/exam/30');
    await heading('Domain 1 exam results', 1);
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(2));
    await afterRefreshWait();
    expect(reported).not.toHaveBeenCalled();
    expect(rewardsBanner()).toBeEmptyDOMElement();
  });

  it('reports an exam that the server closed, when its time ran out, while this page was open elsewhere or the tab was closed: once', async () => {
    // The learner left the exam running and closed the tab. The page was opened again a moment ago; the
    // server closed the exam when it was next read, which stamps it with the time of that read.
    const now = Date.now();
    const closed = {
      ...finished(exam(), 4, { passed: true, xp: 340, newBadges: ['domain-1-complete'] }),
      deadlineAt: new Date(now - 20 * 60_000).toISOString(), submittedAt: new Date(now).toISOString(), serverNow: new Date(now).toISOString(),
    };
    handlers['GET /api/assessments/30'] = () => json(200, closed);
    renderAt('/exam/30');
    const title = await heading('Domain 1 exam results', 1);
    expect(reported.mock.calls).toEqual([[{ xp: 340, newBadges: ['domain-1-complete'] }]]);
    await waitFor(() => expect(rewardsBanner()).toHaveTextContent('Badge earned'));
    // It was not finished on this visit: the page does not celebrate, and the results do not take focus.
    expect(screen.queryByText('Exam passed')).not.toBeInTheDocument();
    expect(title).not.toHaveFocus();
    // One read of the totals: the one the report asks for.
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(2));

    await userEvent.click(screen.getByRole('link', { name: 'leave' }));
    await userEvent.click(screen.getByRole('link', { name: 'come back' }));
    await heading('Domain 1 exam results', 1);
    await afterRefreshWait();
    expect(reported).toHaveBeenCalledTimes(1);
    expect(calls('GET /api/dashboard')).toHaveLength(2);
  });

  it('does not report a result whose time on the server cannot be compared with this page', async () => {
    // Closed by the server after its time ran out, as above, but the response carries no usable server time.
    const now = Date.now();
    const closed = {
      ...finished(exam(), 4, { xp: 340 }),
      deadlineAt: new Date(now - 20 * 60_000).toISOString(), submittedAt: new Date(now).toISOString(), serverNow: 'soon',
    };
    handlers['GET /api/assessments/30'] = () => json(200, closed);
    renderAt('/exam/30');
    await heading('Domain 1 exam results', 1);
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(2));
    expect(reported).not.toHaveBeenCalled();
  });

  it('reports an exam that the server closed while the learner was on another screen, once, when its results are first seen', async () => {
    const open = exam({ answers: { [q1.id]: pick('a') } });
    handlers['GET /api/assessments/30'] = () => json(200, open);
    renderAt('/exam/30');
    await heading('Question 2 of 5');
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(1));
    await userEvent.click(screen.getByRole('link', { name: 'leave' }));
    expect(screen.getByText('path screen')).toBeInTheDocument();

    // The time runs out meanwhile, and the server scores what it has.
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 1, { xp: 12, newBadges: ['hundred-correct'] }, 4));
    await userEvent.click(screen.getByRole('link', { name: 'come back' }));
    const title = await heading('Domain 1 exam results', 1);
    expect(reported.mock.calls).toEqual([[{ xp: 12, newBadges: ['hundred-correct'] }]]);
    await waitFor(() => expect(rewardsBanner()).toHaveTextContent('Badge earned'));
    // It was not finished on this visit: the results do not take focus.
    expect(title).not.toHaveFocus();
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(2));

    // Looked at again, it is an old result.
    await userEvent.click(screen.getByRole('link', { name: 'leave' }));
    await userEvent.click(screen.getByRole('link', { name: 'come back' }));
    await heading('Domain 1 exam results', 1);
    await afterRefreshWait();
    expect(reported).toHaveBeenCalledTimes(1);
    expect(calls('GET /api/dashboard')).toHaveLength(2);
  });

  it('an order question the learner never touched stays unanswered until it is changed', async () => {
    handlers['GET /api/assessments/30'] = () => json(200, exam());
    handlers[SAVE] = () => json(200, { saved: true });
    renderAt('/exam/30');
    await heading('Question 1 of 5');
    await userEvent.click(within(nav()).getByRole('button', { name: 'Question 5, unanswered' }));
    await heading('Question 5 of 5');
    expect(screen.getByText('Not answered yet. Move an item to record your order.')).toBeInTheDocument();
    expect(writes()).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Move down: Implement' }));
    expect(within(nav()).getByRole('button', { name: 'Question 5, answered' })).toBeInTheDocument();
    expect(screen.queryByText('Not answered yet. Move an item to record your order.')).not.toBeInTheDocument();
    await waitFor(() => expect(bodies(SAVE)).toEqual([{ questionId: 'q-1.2-050', answer: { type: 'order', order: ['a', 'c', 'b'] } }]));
  });

  it('does not submit silently when an answer was rejected: the learner retries the save or submits anyway', async () => {
    const open = exam();
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SAVE] = () => json(400, { error: 'Question is not part of this assessment' });
    handlers[SUBMIT] = () => json(200, { result: finished(open, 1).result });
    renderAt('/exam/30');
    await heading('Question 1 of 5');
    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    expect(await screen.findByText("Couldn't save one of your answers.")).toBeInTheDocument();

    await userEvent.click(button('Submit exam'));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your answer to question 1 could not be saved. If you submit now, your latest answer to it will not count.');
    // The message is announced as an alert; the buttons are beside it, not part of the announcement.
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
    expect(calls(SUBMIT)).toHaveLength(0);

    await userEvent.click(button('Keep working'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Alpha' })).toBeEnabled();
    // The pressed button is gone: focus is on the question, not lost.
    expect(screen.getByRole('heading', { level: 2, name: 'Question 1 of 5' })).toHaveFocus();

    // Saving again works this time, and the exam is then submitted.
    await userEvent.click(button('Submit exam'));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));
    await screen.findByRole('alert');
    handlers[SAVE] = () => json(200, { saved: true });
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 1));
    await userEvent.click(button('Try saving again'));

    expect(await heading('Domain 1 exam results', 1)).toBeInTheDocument();
    expect(writes()).toEqual([SAVE, SAVE, SUBMIT]);
    expect(bodies(SAVE)[1]).toEqual({ questionId: 'q-1.1-001', answer: pick('a') });
  });

  it('dismissing the save warning does not let a rejected answer be left out silently', async () => {
    const open = exam();
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SAVE] = () => json(500, { error: 'Server error' });
    handlers[SUBMIT] = () => json(200, { result: finished(open, 2).result });
    renderAt('/exam/30');
    await heading('Question 1 of 5');
    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    await userEvent.click(button('Next'));
    await heading('Question 2 of 5');
    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    // Two answers were dropped, and the indicator does not make one of them.
    await screen.findByText("Couldn't save some of your answers.");

    // The indicator's own Dismiss button: the warning goes, the answers are still not on the server.
    await userEvent.click(button('Dismiss'));
    expect(screen.queryByText(/Couldn't save/)).not.toBeInTheDocument();
    expect(navButtons().slice(0, 2)).toEqual(['Question 1, answered', 'Question 2, answered']);

    await userEvent.click(button('Submit exam'));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your answers to questions 1 and 2 could not be saved. If you submit now, your latest answers to them will not count.');
    expect(calls(SUBMIT)).toHaveLength(0);

    handlers[SAVE] = () => json(200, { saved: true });
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 2));
    await userEvent.click(button('Try saving again'));
    expect(await heading('Domain 1 exam results', 1)).toBeInTheDocument();
    expect(writes()).toEqual([SAVE, SAVE, SAVE, SAVE, SUBMIT]);
    expect(bodies(SAVE).slice(2)).toEqual([
      { questionId: 'q-1.1-001', answer: pick('a') },
      { questionId: 'q-1.1-002', answer: pick('a') },
    ]);
  });

  it('when the time is up, tries once more to save a rejected answer, for a few seconds at most, then submits', async () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    vi.setSystemTime(new Date('2026-11-10T12:00:00.000Z'));
    const open = exam({ serverNow: new Date().toISOString(), deadlineAt: new Date(Date.now() + 10_000).toISOString() });
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SAVE] = () => json(500, { error: 'Server error' });
    handlers[SUBMIT] = () => json(200, { result: finished(open, 0).result });
    renderAt('/exam/30');
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    await settle();
    expect(screen.getByText("Couldn't save one of your answers.")).toBeInTheDocument();
    expect(calls(SAVE)).toHaveLength(1);

    // This time the save neither works nor fails: it hangs.
    const hung = deferred<Response>();
    handlers[SAVE] = () => hung.promise;
    await advance(10_000);
    await settle();
    expect(calls(SAVE)).toHaveLength(2);
    expect(bodies(SAVE)[1]).toEqual({ questionId: 'q-1.1-001', answer: pick('a') });
    expect(calls(SUBMIT)).toHaveLength(0);

    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 0));
    await advance(3_000);
    await settle();
    expect(writes()).toEqual([SAVE, SAVE, SUBMIT]);
    expect(screen.getByRole('heading', { level: 1, name: 'Domain 1 exam results' })).toBeInTheDocument();
    hung.resolve(json(409, { error: 'This assessment is already submitted' }));
    await settle();
  });

  it('when the time is up, a save that gets no answer holds the submission up for a few seconds at most', async () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    vi.setSystemTime(new Date('2026-11-10T12:00:00.000Z'));
    const open = exam({ serverNow: new Date().toISOString(), deadlineAt: new Date(Date.now() + 10_000).toISOString() });
    const hung = deferred<Response>();
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SAVE] = () => hung.promise;
    handlers[SUBMIT] = () => json(200, { result: finished(open, 0).result });
    renderAt('/exam/30');
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    await settle();
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    await advance(10_000);
    await settle();
    expect(submission()).toHaveTextContent('Time is up. Saving your answers…');
    expect(calls(SUBMIT)).toHaveLength(0);
    await advance(2_000);
    expect(calls(SUBMIT)).toHaveLength(0);

    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 0));
    await advance(1_000);
    await settle();
    expect(writes()).toEqual([SAVE, SUBMIT]);
    expect(screen.getByRole('heading', { level: 1, name: 'Domain 1 exam results' })).toBeInTheDocument();
    hung.resolve(json(409, { error: 'This assessment is already submitted' }));
    await settle();
  });

  it('an exam page that is taken away and mounted again at once keeps saving through the same queue', async () => {
    const first = deferred<Response>();
    handlers['GET /api/assessments/30'] = () => json(200, exam());
    handlers[SAVE] = () => first.promise;
    renderAt('/exam/30');
    await heading('Question 1 of 5');
    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    expect(await screen.findByText('Saving…')).toBeInTheDocument();

    await userEvent.click(button('remount'));
    // The new page has the answer that is still on its way, and shows the same queue at work.
    await userEvent.click(within(nav()).getByRole('button', { name: 'Question 1, answered' }));
    expect(screen.getByRole('radio', { name: 'Alpha' })).toBeChecked();
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    // A newer answer waits behind the one in flight, in the same queue, and both reach the server in order.
    await userEvent.click(screen.getByRole('radio', { name: 'Bravo' }));
    expect(calls(SAVE)).toHaveLength(1);
    handlers[SAVE] = () => json(200, { saved: true });
    first.resolve(json(200, { saved: true }));
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
    expect(bodies(SAVE)).toEqual([
      { questionId: 'q-1.1-001', answer: pick('a') },
      { questionId: 'q-1.1-001', answer: pick('b') },
    ]);

    // And it goes on saving after that.
    await userEvent.click(button('Next'));
    await heading('Question 2 of 5');
    await userEvent.click(screen.getByRole('radio', { name: 'Charlie' }));
    await waitFor(() => expect(bodies(SAVE)).toHaveLength(3));
    expect(bodies(SAVE)[2]).toEqual({ questionId: 'q-1.1-002', answer: pick('c') });
  });

  it('"Submit anyway" submits without the answer that could not be saved', async () => {
    const open = exam();
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SAVE] = () => json(400, { error: 'Question is not part of this assessment' });
    handlers[SUBMIT] = () => json(200, { result: finished(open, 0).result });
    renderAt('/exam/30');
    await heading('Question 1 of 5');
    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    await screen.findByText("Couldn't save one of your answers.");
    await userEvent.click(button('Submit exam'));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));
    await screen.findByRole('alert');

    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 0));
    await userEvent.click(button('Submit anyway'));
    expect(await heading('Domain 1 exam results', 1)).toBeInTheDocument();
    expect(writes()).toEqual([SAVE, SUBMIT]);
  });

  // On a phone the page scrolls to the new question, and the second tap of a double tap on "Next" lands on
  // its "Flag for review" button or on one of its options.
  it('a press that arrives with a new question neither flags it nor answers it', async () => {
    const clock = holdPressClock();
    handlers['GET /api/assessments/30'] = () => json(200, exam());
    handlers[SAVE] = () => json(200, { saved: true });
    renderAt('/exam/30');
    await heading('Question 1 of 5');
    clock.advance(SETTLE_MS);

    await userEvent.click(button('Next'));
    await heading('Question 2 of 5');
    await userEvent.click(flagToggle());
    clock.advance(SETTLE_MS - 1);
    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    expect(flagToggle()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('radio', { name: 'Alpha' })).not.toBeChecked();
    expect(within(nav()).getByText('0 of 5 answered, 0 flagged')).toBeInTheDocument();
    expect(writes()).toEqual([]);

    // A moment later the question takes both.
    clock.advance(1);
    await userEvent.click(flagToggle());
    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    expect(flagToggle()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('radio', { name: 'Alpha' })).toBeChecked();
    await waitFor(() => expect(writes()).toEqual([SAVE, SAVE]));
    expect(bodies(SAVE)).toEqual([
      { questionId: 'q-1.1-002', flagged: true },
      { questionId: 'q-1.1-002', answer: pick('a') },
    ]);
  });

  it('a press straight after a prompt appeared is ignored: "Submit now", "Submit anyway", "Keep working" and "Try again" need a moment first', async () => {
    const clock = holdPressClock();
    const open = exam();
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SAVE] = () => json(400, { error: 'Question is not part of this assessment' });
    handlers[SUBMIT] = () => {
      throw new TypeError('Failed to fetch');
    };
    renderAt('/exam/30');
    await heading('Question 1 of 5');
    // The question has been on screen for a while when it is answered.
    clock.advance(SETTLE_MS);
    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    await screen.findByText("Couldn't save one of your answers.");

    // What counts from here on is when the dialog opened.
    clock.advance(SETTLE_MS);
    // The dialog opens over the page; a second press that lands on "Submit now" does not submit.
    await userEvent.click(button('Submit exam'));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Keep working' }));
    expect(dialog()).toBeInTheDocument();
    expect(submission()).toBeEmptyDOMElement();
    clock.advance(SETTLE_MS);
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));

    // The answer could not be saved: three buttons appear with the question about it.
    await screen.findByRole('alert');
    await userEvent.click(button('Submit anyway'));
    await userEvent.click(button('Try saving again'));
    await userEvent.click(button('Keep working'));
    clock.advance(SETTLE_MS - 1);
    await userEvent.click(button('Submit anyway'));
    expect(writes()).toEqual([SAVE]);
    expect(screen.getByRole('alert')).toHaveTextContent('Your answer to question 1 could not be saved.');

    clock.advance(1);
    await userEvent.click(button('Submit anyway'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Couldn't submit your exam."));
    expect(writes()).toEqual([SAVE, SUBMIT]);

    // "Try again" has appeared for the failed submission.
    await userEvent.click(button('Try again'));
    expect(calls(SUBMIT)).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't submit your exam.");
    clock.advance(SETTLE_MS);
    await userEvent.click(button('Try again'));
    // The answer is still not saved, so the question about it comes back, and its buttons with it.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Your answer to question 1 could not be saved.'));
    handlers[SAVE] = () => json(200, { saved: true });
    handlers[SUBMIT] = () => json(200, { result: finished(open, 0).result });
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 0));
    await userEvent.click(button('Try saving again'));
    expect(writes()).toEqual([SAVE, SUBMIT]);
    clock.advance(SETTLE_MS);
    await userEvent.click(button('Try saving again'));
    expect(await heading('Domain 1 exam results', 1)).toBeInTheDocument();
    expect(writes()).toEqual([SAVE, SUBMIT, SAVE, SUBMIT]);
  });

  it('Cancel, while a submission waits for answers to be saved, works the moment it appears', async () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    const clock = holdPressClock();
    handlers['GET /api/assessments/30'] = () => json(200, exam());
    handlers[SAVE] = () => {
      throw new TypeError('Failed to fetch');
    };
    renderAt('/exam/30');
    await settle();
    clock.advance(SETTLE_MS);
    fireEvent.click(screen.getByRole('radio', { name: 'Bravo' }));
    await settle();
    fireEvent.click(button('Submit exam'));
    clock.advance(SETTLE_MS);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));
    await settle();
    expect(submission()).toHaveTextContent('Saving your answers before submitting…');

    // The one way to stop a submission that is about to go: it must not be swallowed.
    fireEvent.click(button('Cancel'));
    expect(submission()).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Bravo' })).toBeEnabled();
    expect(screen.getByRole('heading', { level: 2, name: 'Question 1 of 5' })).toHaveFocus();

    // The save gets through later: nothing is submitted.
    handlers[SAVE] = () => json(200, { saved: true });
    await advance(1_000);
    await settle();
    expect(writes()).toEqual([SAVE, SAVE]);
  });

  it('keeps the learner in the exam with a retry when the submission cannot be sent', async () => {
    const open = exam({ answers: { [q1.id]: pick('a') } });
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SAVE] = () => json(200, { saved: true });
    handlers[SUBMIT] = () => {
      throw new TypeError('Failed to fetch');
    };
    renderAt('/exam/30');
    await heading('Question 2 of 5');
    await userEvent.click(screen.getByRole('radio', { name: 'Charlie' }));
    await userEvent.click(button('Submit exam'));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't submit your exam.");
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
    // Still on the same question, with the answer in place and open to change.
    expect(screen.getByRole('heading', { level: 2, name: 'Question 2 of 5' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Charlie' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Charlie' })).toBeEnabled();
    expect(calls(SUBMIT)).toHaveLength(1);

    const answered = deferred<Response>();
    handlers[SUBMIT] = () => answered.promise;
    await userEvent.click(button('Try again'));
    // The pressed button is gone; focus is on the question rather than nowhere.
    expect(screen.getByRole('heading', { level: 2, name: 'Question 2 of 5' })).toHaveFocus();
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 1));
    answered.resolve(json(200, { result: finished(open, 1).result }));
    expect(await heading('Domain 1 exam results', 1)).toBeInTheDocument();
    expect(calls(SUBMIT)).toHaveLength(2);
  });

  it('gives up on a submission that gets no answer after 20 seconds, and offers a retry', async () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    const open = exam({ answers: { [q1.id]: pick('a') } });
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SUBMIT] = () => new Promise<Response>(() => {});
    renderAt('/exam/30');
    await settle();
    fireEvent.click(button('Submit exam'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));
    await settle();
    expect(submission()).toHaveTextContent('Submitting your exam…');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();

    await advance(19_000);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await advance(1_000);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't submit your exam.");
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeEnabled();

    // Submitting is safe to repeat: the server answers a second submit with the same result.
    handlers[SUBMIT] = () => json(200, { result: finished(open, 1).result });
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 1));
    fireEvent.click(button('Try again'));
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Domain 1 exam results' })).toBeInTheDocument();
    expect(calls(SUBMIT)).toHaveLength(2);
  });

  it('says that the exam was submitted when only the results could not be read, and then only reads again', async () => {
    const open = exam({ answers: { [q1.id]: pick('a') } });
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SUBMIT] = () => json(200, { result: finished(open, 1, { passed: true, xp: 310 }).result });
    renderAt('/exam/30');
    await heading('Question 2 of 5');
    handlers['GET /api/assessments/30'] = () => json(500, { error: 'Server error' });
    await userEvent.click(button('Submit exam'));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Your exam was submitted. Couldn't load the results.");
    expect(screen.queryByText(/Couldn't submit/)).not.toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    // Nothing is left to submit: Submit does not open the dialog again.
    await userEvent.click(button('Submit exam'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 1, { passed: true, xp: 310 }));
    await userEvent.click(button('Try again'));
    expect(await heading('Domain 1 exam results', 1)).toHaveFocus();
    expect(calls(SUBMIT)).toHaveLength(1);
    // A pass seen now is celebrated, as an exam.
    const banner = screen.getByRole('group', { name: 'Exam passed' });
    expect(banner).toHaveTextContent('Domain 1 exam');
    expect(banner).toHaveTextContent('+310 XP');
    expect(screen.queryByText('Quiz passed')).not.toBeInTheDocument();
  });

  it('when the time runs out and the server cannot be reached, says so and offers a retry', async () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    vi.setSystemTime(new Date('2026-11-10T12:00:00.000Z'));
    const open = exam({ serverNow: new Date().toISOString(), deadlineAt: new Date(Date.now() + 62_000).toISOString(), answers: { [q1.id]: pick('a') } });
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SUBMIT] = () => {
      throw new TypeError('Failed to fetch');
    };
    renderAt('/exam/30');
    await settle();
    expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent('01:02');
    // Opened with less than five minutes left: said once, in words that are true.
    expect(screen.getByText('Low time')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Time alerts' })).toHaveTextContent('Less than 5 minutes remaining');
    await advance(2_000);
    expect(screen.getByRole('status', { name: 'Time alerts' })).toHaveTextContent('1 minute remaining');

    await advance(60_000);
    await settle();
    expect(submission()).toHaveTextContent('Time is up.');
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't submit your exam. The answers that were saved will be scored either way.");
    expect(calls(SUBMIT)).toHaveLength(1);
    // The exam stays on screen, closed to changes; a press on Submit does not open the dialog.
    expect(screen.getByRole('heading', { level: 2, name: 'Question 2 of 5' })).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    fireEvent.click(button('Submit exam'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    handlers[SUBMIT] = () => json(200, { result: finished(open, 1, {}, 4).result });
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 1, {}, 4));
    fireEvent.click(button('Try again'));
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Domain 1 exam results' })).toBeInTheDocument();
    expect(calls(SUBMIT)).toHaveLength(2);
  });

  it('several saves that the server refuses because the exam is over lead to one look at the results', async () => {
    const open = exam();
    const first = deferred<Response>();
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SAVE] = () => first.promise;
    renderAt('/exam/30');
    await heading('Question 1 of 5');
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(1));
    // Three saves: one on its way, two waiting behind it.
    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    await userEvent.click(flagToggle());
    await userEvent.click(button('Next'));
    await heading('Question 2 of 5');
    await userEvent.click(screen.getByRole('radio', { name: 'Bravo' }));

    handlers[SAVE] = () => json(409, { error: 'This assessment is already submitted' });
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 0, {}, 5));
    first.resolve(json(409, { error: 'This assessment is already submitted' }));

    expect(await heading('Domain 1 exam results', 1)).toBeInTheDocument();
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 30));
    // One re-read of the exam, one refresh of the totals, and no save sent after the server said no.
    expect(assessmentReads(30)).toBe(2);
    expect(calls('GET /api/dashboard')).toHaveLength(2);
    expect(calls(SAVE)).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('leaving and coming back while a save is retrying keeps one queue: the newest answer is shown and is the one saved', async () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    handlers['GET /api/assessments/30'] = () => json(200, exam());
    handlers[SAVE] = () => {
      throw new TypeError('Failed to fetch');
    };
    renderAt('/exam/30');
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: 'Bravo' }));
    fireEvent.click(flagToggle());
    await settle();
    expect(screen.getByText('Not saved yet. Retrying…')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'leave' }));
    await settle();
    expect(screen.getByText('path screen')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'come back' }));
    await settle();

    // The server has no answer yet; the page shows what the learner chose, and that it is still unsaved.
    expect(navButtons()[0]).toBe('Question 1, answered, flagged');
    expect(screen.getByRole('heading', { level: 2, name: 'Question 2 of 5' })).toBeInTheDocument();
    fireEvent.click(within(nav()).getByRole('button', { name: 'Question 1, answered, flagged' }));
    expect(screen.getByRole('radio', { name: 'Bravo' })).toBeChecked();
    expect(flagToggle()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Not saved yet. Retrying…')).toBeInTheDocument();
    expect(calls(SAVE)).toHaveLength(1);

    // A newer answer replaces the one that was waiting for its retry; the old one is never sent again.
    fireEvent.click(screen.getByRole('radio', { name: 'Charlie' }));
    handlers[SAVE] = () => json(200, { saved: true });
    await advance(1_000);
    await settle();
    expect(bodies(SAVE)).toEqual([
      { questionId: 'q-1.1-001', answer: pick('b') },
      { questionId: 'q-1.1-001', answer: pick('c') },
      { questionId: 'q-1.1-001', flagged: true },
    ]);
    expect(screen.queryByText('Not saved yet. Retrying…')).not.toBeInTheDocument();
    await advance(20_000);
    expect(calls(SAVE)).toHaveLength(3);
  });

  it('a question counts as answered only when its answer is complete', async () => {
    const open = exam({ questions: [multi, match, q1] });
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SAVE] = () => json(200, { saved: true });
    renderAt('/exam/30');
    await heading('Question 1 of 3');

    // A box ticked and unticked again: an answer is stored, but nothing is chosen.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bollards' }));
    expect(navButtons()[0]).toBe('Question 1, answered');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bollards' }));
    expect(navButtons()[0]).toBe('Question 1, unanswered');
    await waitFor(() => expect(bodies(SAVE)).toHaveLength(2));
    expect(bodies(SAVE)[1]).toEqual({ questionId: 'q-1.2-060', answer: { type: 'multi', choices: [] } });

    // One of two matches made.
    await userEvent.click(button('Next'));
    await heading('Question 2 of 3');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Match for Confidentiality' }), 'Encryption');
    expect(navButtons()).toEqual(['Question 1, unanswered', 'Question 2, partly answered', 'Question 3, unanswered']);
    expect(within(nav()).getByText('0 of 3 answered, 0 flagged')).toBeInTheDocument();
    expect(screen.getByText('Partly answered. It counts as unanswered until every item has a match.')).toBeInTheDocument();

    await userEvent.click(button('Submit exam'));
    expect(dialog()).toHaveAccessibleDescription(/3 unanswered, 0 flagged\. 1 of the unanswered is partly answered\./);
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Keep working' }));

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Match for Integrity' }), 'Hashing');
    expect(navButtons()[1]).toBe('Question 2, answered');
    expect(screen.queryByText('Partly answered. It counts as unanswered until every item has a match.')).not.toBeInTheDocument();
    await userEvent.click(button('Submit exam'));
    expect(dialog()).toHaveAccessibleDescription(/2 unanswered, 0 flagged\./);
    expect(dialog()).not.toHaveAccessibleDescription(/partly/);
  });

  it('after a reload a partly answered question is still partly answered, and the exam opens on the first question that is not complete', async () => {
    handlers['GET /api/assessments/30'] = () =>
      json(200, exam({ questions: [q1, match, multi], answers: { [q1.id]: pick('a'), [match.id]: { type: 'match', pairs: { l1: 'r1' } }, [multi.id]: { type: 'multi', choices: [] } } }));
    renderAt('/exam/30');
    await heading('Question 2 of 3');
    expect(navButtons()).toEqual(['Question 1, answered', 'Question 2, partly answered', 'Question 3, unanswered']);
  });

  it('a click on the dialog text does not disable Escape', async () => {
    handlers['GET /api/assessments/30'] = () => json(200, exam());
    renderAt('/exam/30');
    await heading('Question 1 of 5');
    await userEvent.click(button('Submit exam'));
    await userEvent.click(within(dialog()).getByText('5 unanswered, 0 flagged.'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button('Submit exam')).toHaveFocus();
    expect(writes()).toEqual([]);
  });

  it('warns before the page is closed only while a save is on its way', async () => {
    const save = deferred<Response>();
    handlers['GET /api/assessments/30'] = () => json(200, exam());
    handlers[SAVE] = () => save.promise;
    renderAt('/exam/30');
    await heading('Question 1 of 5');
    const leaving = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leaving()).toBe(false);

    await userEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    expect(await screen.findByText('Saving…')).toBeInTheDocument();
    expect(leaving()).toBe(true);

    save.resolve(json(200, { saved: true }));
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
    expect(leaving()).toBe(false);
  });

  it('opens a quiz that was reached through the exam address on the quiz screen', async () => {
    handlers['GET /api/assessments/12'] = () => json(200, quiz(2));
    renderAt('/exam/12');
    expect(await heading('Objective 1.1 quiz', 1)).toBeInTheDocument();
  });

  it.each([
    [404, "This exam isn't available."],
    [500, "Couldn't load this exam."],
  ])('says so when the exam cannot be loaded (%i)', async (status, text) => {
    handlers['GET /api/assessments/30'] = () => json(status, { error: 'Assessment not found' });
    renderAt('/exam/30');
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });
});

describe('the saves of an exam', () => {
  const body = (n: number) => ({ questionId: `q-1.1-00${n}`, answer: pick('a') });
  const leaving = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('are still sent for a page that found them before the last page\'s save finished and took hold of them after', async () => {
    const client = createQueryClient();
    const first = deferred<Response>();
    handlers[SAVE] = () => first.promise;
    const before = examSaves(client, 30);
    before.acquire();
    before.save('q-1.1-001', body(1));
    before.release(); // that page goes while its save is on its way

    const after = examSaves(client, 30); // the next page renders: it finds the same saves
    expect(after).toBe(before);
    first.resolve(json(200, { saved: true })); // the save lands: nobody holds the saves, nothing is left to send
    await after.queue.flush();
    await new Promise((r) => setTimeout(r, 0));

    after.acquire(); // only now do the next page's effects run
    const second = deferred<Response>();
    handlers[SAVE] = () => second.promise;
    after.save('q-1.1-002', body(2));
    await waitFor(() => expect(bodies(SAVE)).toEqual([body(1), body(2)]));
    // They are the exam's saves again: found by the next lookup, and guarding the page while one is on its way.
    expect(examSaves(client, 30)).toBe(after);
    expect(leaving()).toBe(true);
    second.resolve(json(200, { saved: true }));
    await after.queue.flush();
    expect(leaving()).toBe(false);
    after.release();
  });

  it('are let go once nobody holds them and nothing is left to send, and not before', async () => {
    const client = createQueryClient();
    const pending = deferred<Response>();
    handlers[SAVE] = () => pending.promise;
    const saves = examSaves(client, 30);
    saves.acquire();
    saves.acquire(); // a second holder, as when one page replaces another
    saves.save('q-1.1-001', body(1));
    saves.release();
    pending.resolve(json(200, { saved: true }));
    await saves.queue.flush();
    await new Promise((r) => setTimeout(r, 0));
    expect(examSaves(client, 30)).toBe(saves);

    saves.release();
    await new Promise((r) => setTimeout(r, 0));
    expect(examSaves(client, 30)).not.toBe(saves);
  });
});

describe('results', () => {
  const mock = (): AssessmentView => ({
    ...exam({ id: 40, kind: 'mock', scope: null, partial: true, questions: [q1, q2, q3, q4] }),
  });

  it('results: "Missed only" filter hides correct items; mock shows scaled score, domain exam shows percent', async () => {
    // Two right, one wrong, one left blank: 2 of 4 is 50%, scaled 500.
    handlers['GET /api/assessments/40'] = () => json(200, finished(mock(), 2, { scaledScore: 500, xp: 20 }, 1));
    const first = renderAt('/exam/40');

    await heading('Practice exam results', 1);
    expect(screen.getByRole('img', { name: 'Estimated scaled score: 500 out of 900' })).toBeInTheDocument();
    expect(screen.getByText(/CompTIA does not publish its scaling/)).toBeInTheDocument();
    expect(screen.getByText(/Pass mark: 750/)).toBeInTheDocument();
    expect(screen.getByText('Not yet')).toBeInTheDocument();
    expect(screen.getByText('2 of 4 correct')).toBeInTheDocument();
    expect(screen.getByText('XP earned: 20')).toBeInTheDocument();
    expect(screen.getByText(/^Partial practice exam/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to practice exams' })).toHaveAttribute('href', '/exam');

    // Bars per objective, named with the titles from the study path.
    const objectives = within(screen.getByRole('region', { name: 'By objective' }));
    expect(await objectives.findByRole('progressbar', { name: '1.1 Objective 1.1 title: 2 of 3 correct' })).toHaveAttribute('aria-valuenow', '67');
    expect(objectives.getByRole('progressbar', { name: '1.2 Objective 1.2 title: 0 of 1 correct' })).toHaveAttribute('aria-valuenow', '0');

    expect(reviewItems().map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^Question 1: ✓Correct/),
      expect.stringMatching(/^Question 2: ✓Correct/),
      expect.stringMatching(/^Question 3: ✗Incorrect/),
      expect.stringMatching(/^Question 4: ✗Not answered/),
    ]);
    expect(screen.getByText('Showing 4 of 4 questions')).toBeInTheDocument();
    // A long exam stays light: a question is only drawn once its row is opened.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Missed only' }));
    expect(reviewItems().map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^Question 3: ✗Incorrect/),
      expect.stringMatching(/^Question 4: ✗Not answered/),
    ]);
    expect(screen.getByText('Showing 2 of 4 questions')).toBeInTheDocument();

    // Opening a row shows the learner's answer and the feedback, locked.
    const wrong = reviewItems()[0]!;
    expect(wrong).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(wrong);
    expect(wrong).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('radio', { name: 'Bravo' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Bravo' })).toBeDisabled();
    expect(within(result()).getByText('Alpha was the answer.')).toBeInTheDocument();
    expect(screen.getByText('Incorrect (your choice)')).toBeInTheDocument();
    await userEvent.click(wrong);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();

    await userEvent.click(reviewItems()[1]!);
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(screen.getByText('Correct answer (not chosen)')).toBeInTheDocument();
    first.unmount();

    // 3 of the 4 questions of objective 1.1 and 1.2 right, and the order question wrong: 3 of 5 is 60%.
    handlers['GET /api/assessments/30'] = () => json(200, finished(exam(), 3));
    renderAt('/exam/30');
    await heading('Domain 1 exam results', 1);
    expect(screen.getByRole('img', { name: 'Score: 60%' })).toBeInTheDocument();
    expect(screen.getByText(/Pass mark: 75%/)).toBeInTheDocument();
    expect(screen.queryByText(/scaled score/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Partial practice exam/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to path' })).toHaveAttribute('href', '/');
  });

  it('the score ring starts empty and is filled by its animation', () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ResultsView
          result={{ scorePct: 75, passed: true, byDomain: {}, byObjective: {}, xp: 0, newBadges: [] }}
          questions={[]}
          answers={{}}
          feedback={{}}
        />
      </QueryClientProvider>,
    );
    const arc = screen.getByRole('img', { name: 'Score: 75%' }).querySelectorAll('circle')[1]!;
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(Number(arc.getAttribute('stroke-dasharray')));
  });

  it('celebrates a pass as soon as it is told that the result is fresh, not only when it is told at once', () => {
    const props = {
      result: { scorePct: 100, passed: true, byDomain: {}, byObjective: {}, xp: 150, newBadges: [] },
      questions: [], answers: {}, feedback: {}, kind: 'domain' as const, title: 'Domain 1 exam results', passTitle: 'Domain 1 exam',
    };
    const client = createQueryClient();
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <ResultsView {...props} />
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Exam passed')).not.toBeInTheDocument();
    rerender(
      <QueryClientProvider client={client}>
        <ResultsView {...props} fresh />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('group', { name: 'Exam passed' })).toHaveTextContent('+150 XP');
    expect(screen.getByRole('heading', { level: 1, name: 'Domain 1 exam results' })).toHaveFocus();
  });

  it('the celebration of a pass stays where it is until the learner dismisses it', () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ResultsView
          result={{ scorePct: 100, passed: true, byDomain: {}, byObjective: {}, xp: 150, newBadges: [] }}
          questions={[]}
          answers={{}}
          feedback={{}}
          kind="objective"
          title="Objective 1.1 quiz results"
          passTitle="Objective 1.1"
          fresh
        />
      </QueryClientProvider>,
    );
    const title = screen.getByRole('heading', { level: 1, name: 'Objective 1.1 quiz results' });
    // Going by itself would move everything under it up, unprompted, six seconds after the results appeared.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const banner = screen.getByRole('group', { name: 'Quiz passed' });
    fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('group', { name: 'Quiz passed' })).not.toBeInTheDocument();
    expect(title).not.toHaveAccessibleDescription();
  });

  it('shows a bar per domain when the exam covers more than one, and renders prompts as text', async () => {
    const other = { ...single(9, '2.1'), prompt: '<img src=x onerror=alert(1)>' };
    const open = { ...mock(), partial: false, questions: [q1, q4, other] };
    handlers['GET /api/assessments/40'] = () => json(200, finished(open, 2, { scaledScore: 633 }));
    handlers['GET /api/path'] = () => json(200, path([1, 2]));
    renderAt('/exam/40');
    await heading('Practice exam results', 1);

    const domains = within(screen.getByRole('region', { name: 'By domain' }));
    expect(await domains.findByRole('progressbar', { name: 'Domain 1: Domain 1 title: 2 of 2 correct' })).toHaveAttribute('aria-valuenow', '100');
    expect(domains.getByRole('progressbar', { name: 'Domain 2: Domain 2 title: 0 of 1 correct' })).toHaveAttribute('aria-valuenow', '0');
    expect(reviewItems()[2]).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('exam lobby', () => {
  const entry = (id: number, over: Partial<MockHistoryEntry> = {}): MockHistoryEntry => ({
    id, submittedAt: `2026-11-0${id}T10:00:00.000Z`, scaledScore: 600 + id * 50, passed: false, partial: false, ...over,
  });
  const notice = () => screen.queryByText(/^Partial practice exam/);

  it('lobby shows the partial-exam notice when the last assessment or API marks partial', async () => {
    // The API says that an exam started now is partial, and that only Domain 1 has content.
    const first = renderAt('/exam');
    expect(await screen.findByText('Partial practice exam — covers Domain 1 only')).toBeInTheDocument();
    // Its real length, not the full exam's.
    expect(screen.getByText(/^This exam has 11 questions in 11 minutes/)).toBeInTheDocument();
    first.unmount();

    handlers['GET /api/path'] = () => json(200, path([1, 2, 4]));
    handlers['GET /api/dashboard'] = () => json(200, dashboard([], { mockSpec: { questions: 56, minutes: 56, partial: true } }));
    const second = renderAt('/exam');
    expect(await screen.findByText('Partial practice exam — covers Domains 1, 2 and 4 only')).toBeInTheDocument();
    expect(screen.getByText(/^This exam has 56 questions in 56 minutes/)).toBeInTheDocument();
    second.unmount();

    // The path cannot be read: the exam is still known to be partial, only not which domains it covers.
    handlers['GET /api/path'] = () => json(500, { error: 'Server error' });
    const third = renderAt('/exam');
    expect(await screen.findByText('Partial practice exam — it does not cover all five domains yet')).toBeInTheDocument();
    third.unmount();

    // Every domain has content now: the next exam is a full one, whatever the earlier ones were.
    handlers['GET /api/path'] = () => json(200, path([1, 2, 3, 4, 5]));
    handlers['GET /api/dashboard'] = () => json(200, dashboard([entry(1), entry(2, { partial: true })], { mockSpec: FULL_MOCK }));
    renderAt('/exam');
    const history = within(await screen.findByRole('list', { name: 'Your practice exams' }));
    expect(history.getAllByRole('listitem')[0]).toHaveTextContent('Partial');
    expect(notice()).not.toBeInTheDocument();
    expect(screen.getByText(/^90 questions in 90 minutes/)).toBeInTheDocument();
  });

  it('explains the rules, starts one exam on a double click and opens it', async () => {
    const started = deferred<Response>();
    handlers['POST /api/assessments'] = () => started.promise;
    handlers['GET /api/assessments/30'] = () => json(200, exam({ kind: 'mock', scope: null, partial: true }));
    renderAt('/exam');

    expect(await heading('Practice exam', 1)).toBeInTheDocument();
    const rules = within(screen.getByRole('list', { name: 'Exam rules' }));
    expect(await rules.findByText(/one minute per question/i)).toBeInTheDocument();
    expect(rules.getByText(/No feedback until the end/)).toBeInTheDocument();
    expect(rules.getByText(/You need 750 to pass/)).toBeInTheDocument();
    expect(rules.getByText(/CompTIA does not publish its scaling/)).toBeInTheDocument();
    expect(await screen.findByText('No practice exams yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume practice exam' })).not.toBeInTheDocument();

    await userEvent.dblClick(button('Start practice exam'));
    expect(bodies('POST /api/assessments')).toEqual([{ kind: 'mock' }]);
    started.resolve(json(201, { id: 30 }));
    await heading('Question 1 of 5');
    expect(screen.getByRole('heading', { level: 1, name: 'Practice exam' })).toBeInTheDocument();
    expect(calls('POST /api/assessments')).toHaveLength(1);
    // An exam is now in progress: the lobby's data is read again, so that it says "Resume" next time.
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(2));
  });

  it('offers "Resume practice exam" with the time left for an exam in progress, and opens it without starting another', async () => {
    const deadlineAt = new Date(Date.now() + 41.5 * 60_000).toISOString();
    handlers['GET /api/dashboard'] = () => json(200, dashboard([], { openMock: { id: 77, deadlineAt }, mockSpec: FULL_MOCK }));
    handlers['GET /api/assessments/77'] = () => json(200, exam({ id: 77, kind: 'mock', scope: null, deadlineAt }));
    renderAt('/exam');

    const resume = await screen.findByRole('button', { name: 'Resume practice exam' });
    expect(screen.getByText('You have a practice exam in progress, with about 42 minutes left. Its clock is running.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start practice exam' })).not.toBeInTheDocument();

    await userEvent.click(resume);
    await heading('Question 1 of 5');
    expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent(/^41:\d\d$/);
    expect(writes()).toEqual([]);
  });

  it('lists earlier practice exams, newest first, each with its score, outcome and a link to its review', async () => {
    handlers['GET /api/dashboard'] = () => json(200, dashboard([entry(1, { partial: true }), entry(2), entry(3, { scaledScore: 780, passed: true })]));
    renderAt('/exam');

    const rows = within(await screen.findByRole('list', { name: 'Your practice exams' })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('780');
    expect(rows[0]).toHaveTextContent('Passed');
    expect(rows[0]).not.toHaveTextContent('Partial');
    expect(within(rows[0]!).getByRole('link', { name: /^Review/ })).toHaveAttribute('href', '/exam/3');
    expect(rows[0]!.querySelector('time')).toHaveAttribute('datetime', '2026-11-03T10:00:00.000Z');
    expect(rows[1]).toHaveTextContent('700');
    expect(rows[1]).toHaveTextContent('Not yet');
    expect(rows[2]).toHaveTextContent('650');
    expect(rows[2]).toHaveTextContent('Partial');
  });

  it('never claims more time for an exam in progress than the exam has, however wrong the device clock is', async () => {
    // By this device's clock the deadline is three hours away; a mock exam here lasts 11 minutes.
    handlers['GET /api/dashboard'] = () =>
      json(200, dashboard([], { openMock: { id: 77, deadlineAt: new Date(Date.now() + 3 * 3_600_000).toISOString() } }));
    const first = renderAt('/exam');
    await screen.findByRole('button', { name: 'Resume practice exam' });
    expect(screen.getByText('You have a practice exam in progress, with about 11 minutes left. Its clock is running.')).toBeInTheDocument();
    first.unmount();

    // And by a clock that is ahead, the deadline has passed although the server still has the exam open.
    handlers['GET /api/dashboard'] = () =>
      json(200, dashboard([], { openMock: { id: 77, deadlineAt: new Date(Date.now() - 60_000).toISOString() } }));
    renderAt('/exam');
    await screen.findByRole('button', { name: 'Resume practice exam' });
    expect(screen.getByText('You have a practice exam in progress. Its clock is running.')).toBeInTheDocument();
  });

  it('offers no exam while nothing is published, and says so when one cannot be started', async () => {
    handlers['GET /api/path'] = () => json(200, path([]));
    handlers['GET /api/dashboard'] = () => json(200, dashboard([], { mockSpec: { questions: 0, minutes: 0, partial: true } }));
    const first = renderAt('/exam');
    expect(await screen.findByText(/Practice exams open once the first lessons are published/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start practice exam' })).not.toBeInTheDocument();
    expect(notice()).not.toBeInTheDocument();
    first.unmount();

    handlers['GET /api/path'] = () => json(200, path());
    handlers['GET /api/dashboard'] = () => json(200, dashboard());
    handlers['POST /api/assessments'] = () => json(503, { error: 'Service unavailable' });
    renderAt('/exam');
    const start = await screen.findByRole('button', { name: 'Start practice exam' });
    await userEvent.click(start);
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server. Try again in a moment.");
    expect(start).toBeEnabled();
  });
});
