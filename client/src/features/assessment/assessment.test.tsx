import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Answer, Feedback, PublicQuestion } from '../../../../shared/types';
import { api } from '../../api/client';
import type { AssessmentResult, AssessmentView, MockHistoryEntry, PathDomain, PathResponse } from '../../api/types';
import { createQueryClient } from '../../queryClient';
import { ExamLobbyPage } from './ExamLobbyPage';
import { ExamPage } from './ExamPage';
import { QuizPage } from './QuizPage';
import { ResultsView } from './ResultsView';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
/** The health check the exam page reads the server's clock from (the HTTP `Date` header, whole seconds). */
const health = (serverNow = Date.now()) =>
  new Response('{"ok":true}', { status: 200, headers: { Date: new Date(serverNow).toUTCString() } });

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
  answers: {}, flags: [], feedback: {}, deadlineAt: null, submittedAt: null,
  ...over,
});

const examQuestions = [single(1), single(2), single(3), single(4, '1.2'), order];
const [q1, q2, q3, q4] = examQuestions as [PublicQuestion, PublicQuestion, PublicQuestion, PublicQuestion];

const exam = (over: Partial<AssessmentView> = {}): AssessmentView => ({
  id: 30, kind: 'domain', scope: '1', partial: false,
  questions: examQuestions,
  answers: {}, flags: [], feedback: {},
  deadlineAt: new Date(Date.now() + 25 * 60_000).toISOString(), submittedAt: null,
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
  id, title: `Domain ${id} title`, weight: 20, unlocked: id === 1, examPassed: false, hasContent,
  objectives: [1, 2].map((n) => ({
    id: `${id}.${n}`, title: `Objective ${id}.${n} title`, published: hasContent, lessonDone: false, quizPassed: false, mastery: 0,
  })),
});
const path = (withContent: number[] = [1]): PathResponse => ({ domains: [1, 2, 3, 4, 5].map((id) => domain(id, withContent.includes(id))) });

const dashboard = (mockHistory: MockHistoryEntry[] = []) => ({ xp: 120, level: 1, nextLevelXp: 500, streak: 2, mockHistory });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handlers: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;

const keyOf = (url: unknown, init?: RequestInit) => `${init?.method ?? 'GET'} ${String(url)}`;
const calls = (key: string) => fetchMock.mock.calls.filter(([u, i]) => keyOf(u, i) === key);
const bodies = (key: string) => calls(key).map(([, i]) => JSON.parse(String(i.body)));
/** Every request that changes something, in the order it was sent. */
const writes = () => fetchMock.mock.calls.map(([u, i]) => keyOf(u, i)).filter((k) => !k.startsWith('GET'));

const SAVE = 'PUT /api/assessments/30/answers';
const SUBMIT = 'POST /api/assessments/30/submit';

beforeEach(() => {
  handlers = {
    'GET /api/health': () => health(),
    'GET /api/path': () => json(200, path()),
    'GET /api/dashboard': () => json(200, dashboard()),
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const h = handlers[keyOf(url, init)];
    if (!h) throw new Error(`unexpected request ${keyOf(url, init)}`);
    return h(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Stands in for the app shell and the path map: screens that show data an assessment changes. */
function Observers() {
  useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('dashboard') });
  useQuery({ queryKey: ['path'], queryFn: () => api.get('path') });
  return null;
}

function renderAt(url: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <Observers />
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/" element={<p>path screen</p>} />
          <Route path="/quiz/:id" element={<QuizPage />} />
          <Route path="/exam" element={<ExamLobbyPage />} />
          <Route path="/exam/:id" element={<ExamPage />} />
        </Routes>
      </MemoryRouter>
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
const reviewItems = () => within(screen.getByRole('list', { name: 'Questions' })).getAllByRole('button');

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
    const banner = screen.getByText('Quiz passed').closest('[role="status"]') as HTMLElement;
    expect(banner).toHaveTextContent('+100 XP');
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(2));
    await waitFor(() => expect(calls('GET /api/path')).toHaveLength(2));

    await userEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Quiz passed')).not.toBeInTheDocument();
    expect(title).toHaveFocus();
  });

  it('a double click on Check sends one answer and does not skip the feedback', async () => {
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
    // The second half of a double click that lands on the button after it has become "Next" is ignored.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }), { detail: 2 });
    expect(screen.getByRole('heading', { level: 2, name: 'Question 1 of 2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }), { detail: 1 });
    expect(await heading('Question 2 of 2')).toBeInTheDocument();
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
    handlers['GET /api/health'] = () => health(serverNow);
    // The Date header carries whole seconds; the client takes the middle of that second as the server's time.
    const open = exam({ deadlineAt: new Date(serverNow + 500 + 6 * 60_000).toISOString() });
    const done = finished(open, 1, {}, 4);
    handlers['GET /api/assessments/30'] = () => json(200, open);
    renderAt('/exam/30');
    await settle();

    const clock = screen.getByRole('timer', { name: 'Time left' });
    expect(clock).toHaveTextContent('06:00');
    expect(clock).toHaveClass('font-mono');
    // The ticking clock is not announced; a separate polite region carries the two warnings.
    expect(clock.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    const alerts = screen.getByRole('status', { name: 'Time alerts' });
    const announced: string[] = [];
    const observer = new MutationObserver(() => announced.push(alerts.textContent ?? ''));
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

    await advance(4 * 60_000 - 1_000);
    expect(clock).toHaveTextContent('01:01');
    expect(alerts).toHaveTextContent('5 minutes remaining');
    await advance(1_000);
    expect(clock).toHaveTextContent('01:00');
    expect(alerts).toHaveTextContent('1 minute remaining');

    // An answer whose save is still on its way when the time runs out.
    const save = deferred<Response>();
    handlers[SAVE] = () => save.promise;
    handlers[SUBMIT] = () => json(200, { result: done.result });
    fireEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    await advance(60_000);

    expect(clock).toHaveTextContent('00:00');
    expect(screen.getByText('Time is up')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Alpha' })).toBeDisabled();
    expect(calls(SAVE)).toHaveLength(1);
    expect(calls(SUBMIT)).toHaveLength(0);

    handlers['GET /api/assessments/30'] = () => json(200, done);
    save.resolve(json(200, { saved: true }));
    await settle();

    expect(writes()).toEqual([SAVE, SUBMIT]);
    expect(screen.getByRole('heading', { level: 1, name: 'Domain 1 exam results' })).toBeInTheDocument();
    expect(announced).toEqual(['5 minutes remaining', '1 minute remaining']);
    observer.disconnect();
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
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(2));
    expect(calls('GET /api/path')).toHaveLength(2);
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
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 1, {}, 4));
    await userEvent.click(screen.getByRole('radio', { name: 'Bravo' }));

    expect(await heading('Domain 1 exam results', 1)).toBeInTheDocument();
    expect(screen.getByText('1 of 5 correct')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(writes()).toEqual([SAVE]);
  });

  it('shows the results straight away when the exam was finalized while the page was closed', async () => {
    handlers['GET /api/assessments/30'] = () => json(200, finished(exam(), 4, { passed: true, xp: 340 }));
    renderAt('/exam/30');
    await heading('Domain 1 exam results', 1);
    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit exam' })).not.toBeInTheDocument();
    expect(writes()).toEqual([]);
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

    await userEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('One of your answers could not be saved.');
    expect(calls(SUBMIT)).toHaveLength(0);

    await userEvent.click(within(alert).getByRole('button', { name: 'Keep working' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Alpha' })).toBeEnabled();

    // Saving again works this time, and the exam is then submitted.
    await userEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));
    handlers[SAVE] = () => json(200, { saved: true });
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 1));
    await userEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Try saving again' }));

    expect(await heading('Domain 1 exam results', 1)).toBeInTheDocument();
    expect(writes()).toEqual([SAVE, SAVE, SUBMIT]);
    expect(bodies(SAVE)[1]).toEqual({ questionId: 'q-1.1-001', answer: pick('a') });
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
    await userEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));

    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 0));
    await userEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Submit anyway' }));
    expect(await heading('Domain 1 exam results', 1)).toBeInTheDocument();
    expect(writes()).toEqual([SAVE, SUBMIT]);
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
    await userEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Submit now' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't submit your exam.");
    // Still on the same question, with the answer in place and open to change.
    expect(screen.getByRole('heading', { level: 2, name: 'Question 2 of 5' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Charlie' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Charlie' })).toBeEnabled();
    expect(calls(SUBMIT)).toHaveLength(1);

    handlers[SUBMIT] = () => json(200, { result: finished(open, 1).result });
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 1));
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await heading('Domain 1 exam results', 1)).toBeInTheDocument();
    expect(calls(SUBMIT)).toHaveLength(2);
  });

  it('when the time runs out and the server cannot be reached, says so and offers a retry', async () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    vi.setSystemTime(new Date('2026-11-10T12:00:00.000Z'));
    // 1:02 is left (the server's time is taken as the middle of the second in its Date header).
    const open = exam({ deadlineAt: new Date(Date.now() + 500 + 62_000).toISOString(), answers: { [q1.id]: pick('a') } });
    handlers['GET /api/assessments/30'] = () => json(200, open);
    handlers[SUBMIT] = () => {
      throw new TypeError('Failed to fetch');
    };
    renderAt('/exam/30');
    await settle();
    expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent('01:02');
    // Opened with less than five minutes left: the clock warns, but the five-minute mark is not announced
    // as if it had just been reached.
    expect(screen.getByText('Low time')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Time alerts' })).toBeEmptyDOMElement();
    await advance(2_000);
    expect(screen.getByRole('status', { name: 'Time alerts' })).toHaveTextContent('1 minute remaining');

    await advance(60_000);
    await settle();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Time is up. Couldn't submit your exam. The answers that were saved will be scored either way.");
    expect(calls(SUBMIT)).toHaveLength(1);
    // The exam stays on screen, closed to changes; a press on Submit does not open the dialog.
    expect(screen.getByRole('heading', { level: 2, name: 'Question 2 of 5' })).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    handlers[SUBMIT] = () => json(200, { result: finished(open, 1, {}, 4).result });
    handlers['GET /api/assessments/30'] = () => json(200, finished(open, 1, {}, 4));
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Domain 1 exam results' })).toBeInTheDocument();
    expect(calls(SUBMIT)).toHaveLength(2);
  });

  it('counts down on this device\'s clock when the server\'s time cannot be read', async () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    handlers['GET /api/health'] = () => {
      throw new TypeError('Failed to fetch');
    };
    handlers['GET /api/assessments/30'] = () => json(200, exam({ deadlineAt: new Date(Date.now() + 25 * 60_000).toISOString() }));
    renderAt('/exam/30');
    await settle();
    expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent('25:00');
    await advance(1_000);
    expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent('24:59');
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
    // The API says that only Domain 1 has content.
    const first = renderAt('/exam');
    expect(await screen.findByText('Partial practice exam — covers Domain 1 only')).toBeInTheDocument();
    first.unmount();

    handlers['GET /api/path'] = () => json(200, path([1, 2, 4]));
    const second = renderAt('/exam');
    expect(await screen.findByText('Partial practice exam — covers Domains 1, 2 and 4 only')).toBeInTheDocument();
    second.unmount();

    // The path cannot be read: the last practice exam still says that exams are partial.
    handlers['GET /api/path'] = () => json(500, { error: 'Server error' });
    handlers['GET /api/dashboard'] = () => json(200, dashboard([entry(1), entry(2, { partial: true })]));
    const third = renderAt('/exam');
    expect(await screen.findByText('Partial practice exam — it does not cover all five domains yet')).toBeInTheDocument();
    third.unmount();

    // Every domain has content now: the next exam is a full one, whatever the earlier ones were.
    handlers['GET /api/path'] = () => json(200, path([1, 2, 3, 4, 5]));
    renderAt('/exam');
    const history = within(await screen.findByRole('list', { name: 'Your practice exams' }));
    expect(history.getAllByRole('listitem')[0]).toHaveTextContent('Partial');
    expect(notice()).not.toBeInTheDocument();
    expect(await screen.findByText(/^90 questions in 90 minutes/)).toBeInTheDocument();
  });

  it('explains the rules, starts one exam on a double click and opens it', async () => {
    const started = deferred<Response>();
    handlers['POST /api/assessments'] = () => started.promise;
    handlers['GET /api/assessments/30'] = () => json(200, exam({ kind: 'mock', scope: null, partial: true }));
    renderAt('/exam');

    expect(await heading('Practice exam', 1)).toBeInTheDocument();
    const rules = within(screen.getByRole('list', { name: 'Exam rules' }));
    expect(rules.getByText(/one minute per question/i)).toBeInTheDocument();
    expect(rules.getByText(/No feedback until the end/)).toBeInTheDocument();
    expect(rules.getByText(/You need 750 to pass/)).toBeInTheDocument();
    expect(rules.getByText(/CompTIA does not publish its scaling/)).toBeInTheDocument();
    expect(await screen.findByText('No practice exams yet.')).toBeInTheDocument();

    await userEvent.dblClick(screen.getByRole('button', { name: 'Start practice exam' }));
    expect(bodies('POST /api/assessments')).toEqual([{ kind: 'mock' }]);
    // 201 for a new exam, 200 for one that was already open: either way the exam with that id is opened.
    started.resolve(json(200, { id: 30 }));
    await heading('Question 1 of 5');
    expect(screen.getByRole('heading', { level: 1, name: 'Practice exam' })).toBeInTheDocument();
    expect(calls('POST /api/assessments')).toHaveLength(1);
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

  it('offers no exam while nothing is published, and says so when one cannot be started', async () => {
    handlers['GET /api/path'] = () => json(200, path([]));
    const first = renderAt('/exam');
    expect(await screen.findByText(/Practice exams open once the first lessons are published/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start practice exam' })).not.toBeInTheDocument();
    first.unmount();

    handlers['GET /api/path'] = () => json(200, path());
    handlers['POST /api/assessments'] = () => json(503, { error: 'Service unavailable' });
    renderAt('/exam');
    const start = await screen.findByRole('button', { name: 'Start practice exam' });
    await userEvent.click(start);
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server. Try again in a moment.");
    expect(start).toBeEnabled();
  });
});
