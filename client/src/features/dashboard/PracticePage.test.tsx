import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Feedback, PublicQuestion } from '../../../../shared/types';
import type { AnswerResponse } from '../../api/types';
import { createQueryClient } from '../../queryClient';
import { holdPressClock } from '../../test/pressClock';
import { SETTLE_MS } from '../../ui/pressGuard';
import { RewardsContext, type RewardsValue } from '../rewards/RewardsProvider';
import { PracticePage } from './PracticePage';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const q1: PublicQuestion = {
  id: 'q-1.2-001', objective: '1.2', difficulty: 1, type: 'single',
  prompt: 'Which part of the CIA triad does a hash protect?',
  options: [
    { id: 'a', text: 'Confidentiality' },
    { id: 'b', text: 'Integrity' },
  ],
};
const q2: PublicQuestion = {
  id: 'q-1.2-002', objective: '1.2', difficulty: 2, type: 'order',
  prompt: 'Put the AAA stages in order.',
  items: [
    { id: 'i2', text: 'Authorization' },
    { id: 'i1', text: 'Authentication' },
    { id: 'i3', text: 'Accounting' },
  ],
};
const q3: PublicQuestion = {
  id: 'q-1.2-003', objective: '1.2', difficulty: 1, type: 'single',
  prompt: 'Which plane makes the access decision in zero trust?',
  options: [
    { id: 'a', text: 'Control plane' },
    { id: 'b', text: 'Data plane' },
  ],
};

const feedback = (correct: boolean, explanation: string): Feedback => ({
  correct, fraction: correct ? 1 : 0, explanation, correctAnswer: { type: 'single', choice: 'b' }, why: {},
});
const answered = (correct: boolean, explanation: string, xp = 0, newBadges: string[] = []): AnswerResponse => ({
  feedback: feedback(correct, explanation), xp, newBadges,
});

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handlers: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;
let report: Mock<RewardsValue['report']>;

const keyOf = (url: unknown, init?: RequestInit) => `${init?.method ?? 'GET'} ${String(url)}`;
const calls = (key: string) => fetchMock.mock.calls.filter(([u, i]) => keyOf(u, i) === key);
const bodies = (key: string) => calls(key).map(([, i]) => JSON.parse(String(i.body)));

const PRACTICE = 'GET /api/practice/1.2';
const ANSWERS = 'POST /api/answers';

beforeEach(() => {
  handlers = { [PRACTICE]: () => json(200, { questions: [q1, q2] }) };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const h = handlers[keyOf(url, init)];
    if (!h) throw new Error(`unexpected request ${keyOf(url, init)}`);
    return h(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } }); // no 1 s retry wait
  report = vi.fn<RewardsValue['report']>();
});
afterEach(() => vi.unstubAllGlobals());

function renderPractice(route = '/practice/1.2') {
  return render(
    <QueryClientProvider client={client}>
      <RewardsContext.Provider value={{ report }}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/" element={<p>path screen</p>} />
            <Route path="/dashboard" element={<p>dashboard screen</p>} />
            <Route path="/practice/:objective" element={<PracticePage />} />
          </Routes>
        </MemoryRouter>
      </RewardsContext.Provider>
    </QueryClientProvider>,
  );
}

const result = () => screen.getByRole('status', { name: 'Result' });
const button = (name: string) => screen.getByRole('button', { name });

describe('practice', () => {
  it('practice: runs through returned questions and reports XP; empty list shows "Nothing to practice here — mastery is 100%"', async () => {
    const replies = [answered(true, 'A hash shows that data has changed.', 10, ['hundred-correct']), answered(false, 'Authentication comes first.')];
    handlers[ANSWERS] = () => json(200, replies[calls(ANSWERS).length - 1]);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const first = renderPractice();

    expect(await screen.findByRole('heading', { level: 1, name: 'Practice: objective 1.2' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Question 1 of 2' })).toBeInTheDocument();
    expect(screen.getByText(q1.prompt)).toBeInTheDocument();
    expect(button('Check')).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: 'Integrity' }));
    await userEvent.click(button('Check'));
    expect(await within(result()).findByText('A hash shows that data has changed.')).toBeInTheDocument();
    expect(bodies(ANSWERS)).toEqual([{ questionId: q1.id, answer: { type: 'single', choice: 'b' } }]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenLastCalledWith({ xp: 10, newBadges: ['hundred-correct'] });
    expect(screen.queryByRole('button', { name: 'Check' })).not.toBeInTheDocument();

    await userEvent.click(button('Next'));
    const second = await screen.findByRole('heading', { name: 'Question 2 of 2' });
    expect(second).toHaveFocus();
    expect(screen.getByText(q2.prompt)).toBeInTheDocument();
    expect(screen.queryByText('A hash shows that data has changed.')).not.toBeInTheDocument();

    // An order question that was not touched is answered with the order it was served in.
    expect(button('Check')).toBeEnabled();
    await userEvent.click(button('Check'));
    expect(await within(result()).findByText('Authentication comes first.')).toBeInTheDocument();
    expect(bodies(ANSWERS)[1]).toEqual({ questionId: q2.id, answer: { type: 'order', order: ['i2', 'i1', 'i3'] } });
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith({ xp: 0, newBadges: [] });

    await userEvent.click(button('Finish'));
    const done = await screen.findByRole('heading', { name: 'Practice complete' });
    expect(done).toHaveFocus();
    const summary = screen.getByRole('region', { name: 'Practice complete' });
    expect(summary).toHaveTextContent('1 of 2 correct');
    expect(summary).toHaveTextContent('XP earned10');
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: 'Back to path' })).toHaveAttribute('href', '/');
    // The last answer earned no XP, so nothing was reported that would refresh the dashboard, and its
    // mastery has changed: the page asks for it once, with the path.
    expect(invalidate.mock.calls.filter(([f]) => f?.queryKey?.[0] === 'dashboard')).toHaveLength(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['path'] });
    expect(calls(ANSWERS)).toHaveLength(2);
    first.unmount();

    handlers[PRACTICE] = () => json(200, { questions: [] });
    renderPractice();
    expect(await screen.findByText('Nothing to practice here — mastery is 100%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to path' })).toBeInTheDocument();
    expect(calls(PRACTICE)).toHaveLength(2); // a new visit asks the server again
  });

  it('never posts an answer twice: a double click on Check, and a click while the answer is on its way', async () => {
    const pending = deferred<Response>();
    handlers[ANSWERS] = () => pending.promise;
    renderPractice();
    await userEvent.click(await screen.findByRole('radio', { name: 'Integrity' }));

    const check = button('Check');
    await userEvent.dblClick(check);
    await userEvent.click(check);
    expect(calls(ANSWERS)).toHaveLength(1);

    pending.resolve(json(200, answered(true, 'A hash shows that data has changed.', 10)));
    expect(await within(result()).findByText('A hash shows that data has changed.')).toBeInTheDocument();
    expect(calls(ANSWERS)).toHaveLength(1);
    expect(report).toHaveBeenCalledTimes(1);
  });

  // Ordinary presses, sent straight after the button under them has changed. Time stands still unless the
  // test moves it, so each press is inside or outside the settle window exactly as written.
  it('a press straight after the button changed is ignored: Check does not run into Next, Next does not grade an untouched order question', async () => {
    const clock = holdPressClock();
    handlers[ANSWERS] = () => json(200, answered(true, 'A hash shows that data has changed.', 10));
    renderPractice();
    const option = await screen.findByRole('radio', { name: 'Integrity' });
    // The question has been on screen for a while when it is answered.
    clock.advance(SETTLE_MS);
    await userEvent.click(option);
    await userEvent.click(button('Check'));

    // "Next" is now where "Check" was.
    const next = await screen.findByRole('button', { name: 'Next' });
    await userEvent.click(next);
    clock.advance(SETTLE_MS - 1);
    await userEvent.click(next);
    expect(screen.getByRole('heading', { name: 'Question 1 of 2' })).toBeInTheDocument();
    expect(within(result()).getByText('A hash shows that data has changed.')).toBeInTheDocument();
    expect(next).toBeEnabled();
    expect(calls(ANSWERS)).toHaveLength(1);

    clock.advance(1);
    await userEvent.click(next);
    expect(await screen.findByRole('heading', { name: 'Question 2 of 2' })).toBeInTheDocument();
    // The order question is complete as it was served: its Check is live, and must not be pressed unseen.
    expect(button('Check')).toBeEnabled();
    await userEvent.click(button('Check'));
    clock.advance(SETTLE_MS - 1);
    await userEvent.click(button('Check'));
    expect(calls(ANSWERS)).toHaveLength(1);
    expect(result()).toBeEmptyDOMElement();

    clock.advance(1);
    await userEvent.click(button('Check'));
    await screen.findByRole('button', { name: 'Finish' });
    expect(bodies(ANSWERS)[1]).toEqual({ questionId: q2.id, answer: { type: 'order', order: ['i2', 'i1', 'i3'] } });
  });

  it('a press straight after a question could not be marked does not skip it', async () => {
    const clock = holdPressClock();
    handlers[ANSWERS] = () => json(404, { error: 'Question not found' });
    renderPractice();
    const option = await screen.findByRole('radio', { name: 'Integrity' });
    // The question has been on screen for a while when it is answered.
    clock.advance(SETTLE_MS);
    await userEvent.click(option);
    await userEvent.click(button('Check'));

    // "Skip this question" is now where "Check" was.
    const skip = await screen.findByRole('button', { name: 'Skip this question' });
    await userEvent.click(skip);
    expect(screen.getByRole('heading', { name: 'Question 1 of 2' })).toBeInTheDocument();
    clock.advance(SETTLE_MS);
    await userEvent.click(skip);
    expect(await screen.findByRole('heading', { name: 'Question 2 of 2' })).toBeInTheDocument();
  });

  it('a network failure keeps the question and the chosen answer, and "Try again" sends it', async () => {
    let online = false;
    handlers[ANSWERS] = () => (online ? json(200, answered(true, 'A hash shows that data has changed.', 10)) : Promise.reject(new TypeError('offline')));
    renderPractice();
    await userEvent.click(await screen.findByRole('radio', { name: 'Integrity' }));
    await userEvent.click(button('Check'));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send your answer. It has not been marked yet.");
    expect(screen.getByRole('heading', { name: 'Question 1 of 2' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Integrity' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Integrity' })).toBeEnabled();
    expect(report).not.toHaveBeenCalled();

    online = true;
    await userEvent.click(button('Try again'));
    expect(await within(result()).findByText('A hash shows that data has changed.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(bodies(ANSWERS)).toEqual([
      { questionId: q1.id, answer: { type: 'single', choice: 'b' } },
      { questionId: q1.id, answer: { type: 'single', choice: 'b' } },
    ]);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('a question the server will not mark can be skipped, and the summary counts only marked answers', async () => {
    handlers[PRACTICE] = () => json(200, { questions: [q1, q3] });
    handlers[ANSWERS] = (_url, init) =>
      JSON.parse(String(init?.body)).questionId === q1.id
        ? json(404, { error: 'Question not found' })
        : json(200, answered(true, 'The control plane decides.', 2));
    renderPractice();
    await userEvent.click(await screen.findByRole('radio', { name: 'Integrity' }));
    await userEvent.click(button('Check'));
    expect(await screen.findByRole('alert')).toHaveTextContent("This question can't be marked.");
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check' })).not.toBeInTheDocument();

    await userEvent.click(button('Skip this question'));
    expect(await screen.findByRole('heading', { name: 'Question 2 of 2' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Control plane' }));
    await userEvent.click(button('Check'));
    await within(result()).findByText('The control plane decides.');
    await userEvent.click(button('Finish'));
    const summary = await screen.findByRole('region', { name: 'Practice complete' });
    expect(summary).toHaveTextContent('1 of 1 correct');
    expect(summary).toHaveTextContent('1 question skipped');
  });

  it('keeps keyboard focus by the question when Check gives way to Next', async () => {
    handlers[ANSWERS] = () => json(200, answered(true, 'A hash shows that data has changed.', 10));
    renderPractice();
    await userEvent.click(await screen.findByRole('radio', { name: 'Integrity' }));
    button('Check').focus();
    await userEvent.keyboard('{Enter}');
    await within(result()).findByText('A hash shows that data has changed.');
    expect(screen.getByRole('region', { name: 'Question 1 of 2' })).toHaveFocus();
    await userEvent.tab();
    expect(button('Next')).toHaveFocus();
  });

  it('says why a locked or unknown objective cannot be practiced', async () => {
    handlers['GET /api/practice/2.1'] = () => json(403, { error: 'Pass the previous domain exam to unlock this domain' });
    const locked = renderPractice('/practice/2.1');
    expect(await screen.findByRole('alert')).toHaveTextContent('This objective is locked. Pass the previous domain exam to unlock this domain.');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to path' })).toBeInTheDocument();
    locked.unmount();

    handlers['GET /api/practice/9.9'] = () => json(404, { error: 'Objective not found' });
    renderPractice('/practice/9.9');
    expect(await screen.findByRole('alert')).toHaveTextContent('Objective 9.9 is not available to practice.');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('a server error while loading offers "Try again"', async () => {
    handlers[PRACTICE] = () => json(500, { error: 'Internal error' });
    renderPractice();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the practice questions.");
    handlers[PRACTICE] = () => json(200, { questions: [q1] });
    await userEvent.click(button('Try again'));
    expect(await screen.findByRole('heading', { name: 'Question 1 of 1' })).toBeInTheDocument();
  });

  it('leaves the dashboard to `report` when the last marked answer earned XP: the page refreshes only the path', async () => {
    handlers[PRACTICE] = () => json(200, { questions: [q1, q3] });
    const replies = [answered(false, 'A hash shows that data has changed.'), answered(true, 'The control plane decides.', 10)];
    handlers[ANSWERS] = () => json(200, replies[calls(ANSWERS).length - 1]);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const page = renderPractice();
    await userEvent.click(await screen.findByRole('radio', { name: 'Confidentiality' }));
    await userEvent.click(button('Check'));
    await within(result()).findByText('A hash shows that data has changed.');
    await userEvent.click(button('Next'));
    await userEvent.click(await screen.findByRole('radio', { name: 'Control plane' }));
    await userEvent.click(button('Check'));
    await within(result()).findByText('The control plane decides.');
    // The report of the XP reads the dashboard after it, which also covers the wrong answer before it.
    expect(report).toHaveBeenLastCalledWith({ xp: 10, newBadges: [] });

    await userEvent.click(button('Finish'));
    await screen.findByRole('heading', { name: 'Practice complete' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['path'] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    page.unmount();
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('leaving half way still tells the dashboard and the path to read their numbers again', async () => {
    handlers[ANSWERS] = () => json(200, answered(false, 'A hash shows that data has changed.'));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const page = renderPractice();
    await userEvent.click(await screen.findByRole('radio', { name: 'Confidentiality' }));
    await userEvent.click(button('Check'));
    await within(result()).findByText('A hash shows that data has changed.');
    expect(invalidate).not.toHaveBeenCalled();

    page.unmount();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['path'] });
  });
});
