import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Feedback, PublicQuestion } from '../../../../shared/types';
import type { DashboardResponse, ReviewCard, ReviewDueResponse, ReviewResponse } from '../../api/types';
import { formatDay } from '../../lib/dates';
import { createQueryClient } from '../../queryClient';
import { holdPressClock } from '../../test/pressClock';
import { SETTLE_MS } from '../../ui/pressGuard';
import { REFRESH_DELAY_MS, RewardsBanner, RewardsContext, RewardsProvider, type RewardsValue } from '../rewards/RewardsProvider';
import { ReviewPage } from './ReviewPage';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const single: PublicQuestion = {
  id: 'q-1.1-001', objective: '1.1', difficulty: 1, type: 'single',
  prompt: 'Which control category does a firewall rule belong to?',
  options: [
    { id: 'a', text: 'Technical' },
    { id: 'b', text: 'Managerial' },
    { id: 'c', text: 'Operational' },
    { id: 'd', text: 'Physical' },
  ],
};

const order: PublicQuestion = {
  id: 'q-1.3-003', objective: '1.3', difficulty: 2, type: 'order',
  prompt: 'Put the change steps in order.',
  items: [
    { id: 'c', text: 'Implement' },
    { id: 'a', text: 'Request' },
    { id: 'b', text: 'Approve' },
  ],
};

const right: Feedback = {
  correct: true, fraction: 1, correctAnswer: { type: 'single', choice: 'a' },
  explanation: 'A firewall rule is enforced by technology.',
  why: { a: 'Enforced by a system.', b: 'Policies are managerial.', c: 'People carry out operational controls.', d: 'Nothing tangible.' },
};
const wrong: Feedback = { ...right, correct: false, fraction: 0 };

const DEFINITIONS: Record<string, string> = {
  'f-1.1-001': 'A measure put in place to reduce risk.',
  'f-1.1-002': 'How a control is implemented.',
  'f-1.1-003': 'What a control does about an incident.',
};
const TERMS: Record<string, string> = {
  'f-1.1-001': 'Security control',
  'f-1.1-002': 'Control category',
  'f-1.1-003': 'Control type',
};

const flash = (n: number): ReviewCard => {
  const id = `f-1.1-00${n}`;
  return { cardId: `f:${id}`, kind: 'flashcard', term: TERMS[id]! };
};
const questionCard = (question: PublicQuestion): ReviewCard => ({ cardId: `q:${question.id}`, kind: 'question', question });
const due = (cards: ReviewCard[], total = cards.length, nextDueOn: string | null = null): ReviewDueResponse => ({ total, cards, nextDueOn });

const enc = encodeURIComponent;
const DUE = 'GET /api/review/due';
const reveal = (card: ReviewCard) => `GET /api/review/flashcard/${enc(card.cardId)}`;
const post = (card: ReviewCard) => `POST /api/review/${enc(card.cardId)}`;

/** What the server answers when a card is reviewed. Unless said otherwise, a right answer came from the box below. */
const moved = (box: number, dueOn: string, xp: number, more: Partial<ReviewResponse> = {}): ReviewResponse => ({
  box, previousBox: box > 1 ? box - 1 : 1, dueOn, xp, newBadges: [], ...more,
});

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handlers: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;
/** Stands in for the rewards provider: what the review round reports to it. */
let report: Mock<RewardsValue['report']>;

const keyOf = (url: unknown, init?: RequestInit) => `${init?.method ?? 'GET'} ${String(url)}`;
const calls = (key: string) => fetchMock.mock.calls.filter(([u, i]) => keyOf(u, i) === key);
const bodies = (key: string) => calls(key).map(([, i]) => JSON.parse(String(i.body)));
const writes = () => fetchMock.mock.calls.map(([u, i]) => keyOf(u, i)).filter((k) => !k.startsWith('GET'));

/** Serves the cards as due, with a definition for every flashcard among them. */
function serve(cards: ReviewCard[], total = cards.length, nextDueOn: string | null = null) {
  handlers[DUE] = () => json(200, due(cards, total, nextDueOn));
  for (const card of cards) {
    if (card.kind === 'flashcard') handlers[reveal(card)] = () => json(200, { definition: DEFINITIONS[card.cardId.slice(2)] });
  }
}

beforeEach(() => {
  handlers = {};
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const h = handlers[keyOf(url, init)];
    if (!h) throw new Error(`unexpected request ${keyOf(url, init)}`);
    return h(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  client = createQueryClient();
  report = vi.fn<RewardsValue['report']>();
});
afterEach(() => vi.unstubAllGlobals());

/** The app around a page: the query client, the rewards (a stand-in, unless given) and the router. */
function App({ children, rewards }: { children: ReactNode; rewards?: (page: ReactNode) => ReactNode }) {
  const page = <MemoryRouter initialEntries={['/review']}>{children}</MemoryRouter>;
  return (
    <QueryClientProvider client={client}>
      {rewards ? rewards(page) : <RewardsContext.Provider value={{ report }}>{page}</RewardsContext.Provider>}
    </QueryClientProvider>
  );
}

const routes = (
  <Routes>
    <Route path="/" element={<p>path screen</p>} />
    <Route path="/review" element={<ReviewPage />} />
  </Routes>
);

function renderReview() {
  return render(<App>{routes}</App>);
}

const cardHeading = (name: string) => screen.findByRole('heading', { level: 2, name });
const result = () => screen.getByRole('status', { name: 'Result' });
const button = (name: string) => screen.getByRole('button', { name });
/** The value shown next to a label of the summary. */
const stat = (label: string) => screen.getByText(label).nextElementSibling;

async function showAnswer() {
  await userEvent.click(button('Show answer'));
  await screen.findByRole('button', { name: 'I knew it' });
}

describe('review', () => {
  it('review: empty state when total is 0', async () => {
    serve([], 0, '2026-11-12');
    renderReview();
    const line = await screen.findByText(/^Nothing due today\./);
    // The date is the server's, as a calendar day in the learner's locale.
    expect(line).toHaveTextContent(`Nothing due today. Next review: ${formatDay('2026-11-12')}.`);
    expect(line).toHaveTextContent(/\b12\b/);
    expect(screen.getByRole('link', { name: 'Back to path' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('the empty state names no date when the learner has no card waiting', async () => {
    serve([], 0, null);
    renderReview();
    expect(await screen.findByText(/^Nothing due today\./)).toHaveTextContent(/^Nothing due today\.$/);
    expect(screen.queryByText(/Next review/)).not.toBeInTheDocument();
  });

  it('review: flashcard hides the definition until Show answer; "I knew it" posts knewIt true and advances', async () => {
    const [first, second] = [flash(1), flash(2)];
    serve([first, second]);
    handlers[post(first)] = () => json(200, moved(2, '2026-11-12', 2, { definition: DEFINITIONS['f-1.1-001'] }));
    renderReview();

    expect(await cardHeading('Card 1 of 2: flashcard')).toBeInTheDocument();
    expect(screen.getByText('Security control')).toBeInTheDocument();
    // Not on the page in any form, and not even asked for yet.
    expect(document.body.innerHTML).not.toContain('A measure put in place');
    expect(calls(reveal(first))).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'I knew it' })).not.toBeInTheDocument();

    await userEvent.click(button('Show answer'));
    const definition = await screen.findByText('A measure put in place to reduce risk.');
    // Focus goes to the definition, so it is read out; the two answers follow it in the tab order.
    expect(definition).toHaveFocus();
    await userEvent.tab();
    expect(button('I knew it')).toHaveFocus();
    await userEvent.tab();
    expect(button("I didn't")).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Show answer' })).not.toBeInTheDocument();

    await userEvent.click(button('I knew it'));
    const next = await cardHeading('Card 2 of 2: flashcard');
    expect(bodies(post(first))).toEqual([{ knewIt: true }]);
    expect(next).toHaveFocus();
    expect(screen.getByText('Control category')).toBeInTheDocument();
    // The new card starts hidden again.
    expect(document.body.innerHTML).not.toContain('How a control is implemented');
    expect(button('Show answer')).toBeInTheDocument();
  });

  it('review: keyboard — Space reveals, 1 and 2 grade', async () => {
    const [first, second] = [flash(1), flash(2)];
    serve([first, second]);
    handlers[post(first)] = () => json(200, moved(2, '2026-11-12', 2));
    handlers[post(second)] = () => json(200, moved(1, '2026-11-11', 0));
    renderReview();
    await cardHeading('Card 1 of 2: flashcard');
    // The shortcuts are written on the page.
    expect(screen.getByText(/press Space or Enter/i)).toBeInTheDocument();

    await userEvent.keyboard(' ');
    expect(await screen.findByText('A measure put in place to reduce risk.')).toBeInTheDocument();
    expect(screen.getByText(/press 1/i)).toBeInTheDocument();
    expect(screen.getByText(/press 2/i)).toBeInTheDocument();
    await userEvent.keyboard('1');
    await cardHeading('Card 2 of 2: flashcard');
    expect(bodies(post(first))).toEqual([{ knewIt: true }]);

    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('How a control is implemented.')).toBeInTheDocument();
    await userEvent.keyboard('2');
    expect(await screen.findByRole('heading', { level: 2, name: 'Review complete' })).toBeInTheDocument();
    expect(bodies(post(second))).toEqual([{ knewIt: false }]);
  });

  it('a held or repeated key grades and reveals one card only', async () => {
    const [first, second] = [flash(1), flash(2)];
    serve([first, second]);
    const answer = deferred<Response>();
    handlers[post(first)] = () => answer.promise;
    renderReview();
    await cardHeading('Card 1 of 2: flashcard');

    // Grading keys do nothing before the answer is shown.
    await userEvent.keyboard('1');
    await userEvent.keyboard('2');
    expect(writes()).toEqual([]);

    await userEvent.keyboard(' ');
    fireEvent.keyDown(document.body, { key: ' ', repeat: true });
    await screen.findByText('A measure put in place to reduce risk.');
    expect(calls(reveal(first))).toHaveLength(1);

    // An auto-repeating key is not a second answer.
    fireEvent.keyDown(document.body, { key: '1', repeat: true });
    expect(writes()).toEqual([]);

    await userEvent.keyboard('1');
    await userEvent.keyboard('1');
    await userEvent.keyboard('2');
    expect(writes()).toEqual([post(first)]);

    answer.resolve(json(200, moved(2, '2026-11-12', 2)));
    await cardHeading('Card 2 of 2: flashcard');
    // Keys that are still held when the next card arrives neither reveal nor grade it.
    fireEvent.keyDown(document.body, { key: '1', repeat: true });
    fireEvent.keyDown(document.body, { key: ' ', repeat: true });
    fireEvent.keyDown(document.body, { key: 'Enter', repeat: true });
    await userEvent.keyboard('1');
    expect(writes()).toEqual([post(first)]);
    expect(calls(reveal(second))).toHaveLength(0);
    expect(button('Show answer')).toBeInTheDocument();
  });

  it('shortcuts leave modifier combinations, form fields and other focused controls alone', async () => {
    const first = flash(1);
    serve([first]);
    render(
      <App>
        <label>
          Notes <input />
        </label>
        <button type="button">Elsewhere</button>
        <a href="/somewhere">A link</a>
        <ReviewPage />
      </App>,
    );
    await cardHeading('Card 1 of 1: flashcard');

    await userEvent.keyboard('{Control>} {/Control}');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await userEvent.keyboard('{Alt>} {/Alt}');
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    screen.getByRole('textbox', { name: 'Notes' }).focus();
    await userEvent.keyboard(' {Enter}1');
    button('Elsewhere').focus();
    await userEvent.keyboard(' {Enter}');
    screen.getByRole('link', { name: 'A link' }).focus();
    await userEvent.keyboard(' ');
    fireEvent.keyDown(screen.getByRole('link', { name: 'A link' }), { key: 'Enter' });
    expect(calls(reveal(first))).toHaveLength(0);
    expect(button('Show answer')).toBeInTheDocument();

    // On the reveal button itself, Enter is the button's own click: one request.
    button('Show answer').focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByText('A measure put in place to reduce risk.');
    expect(calls(reveal(first))).toHaveLength(1);

    // Once the answer is shown, the grading keys keep out of form fields and modifier combinations too.
    screen.getByRole('textbox', { name: 'Notes' }).focus();
    await userEvent.keyboard('12');
    await userEvent.keyboard('{Control>}1{/Control}');
    await userEvent.keyboard('{Meta>}2{/Meta}');
    expect(writes()).toEqual([]);

    // Nor do they act while focus is on something outside the card, such as a link or a button of the header.
    screen.getByRole('link', { name: 'A link' }).focus();
    await userEvent.keyboard('1');
    button('Elsewhere').focus();
    await userEvent.keyboard('2');
    expect(writes()).toEqual([]);
  });

  it('Space and Enter on one of the card\'s own buttons are that button\'s, not a second "Show answer"', async () => {
    const [first, second] = [flash(1), flash(2)];
    serve([first, second]);
    handlers[reveal(first)] = () => json(500, { error: 'Internal error' });
    renderReview();
    await cardHeading('Card 1 of 2: flashcard');
    await userEvent.click(button('Show answer'));
    await screen.findByRole('alert');
    expect(calls(reveal(first))).toHaveLength(1);
    // The answer is still hidden, so the shortcut is live; but focus is on a button inside the card.
    button('Skip this card').focus();
    await userEvent.keyboard('{Enter}');
    await cardHeading('Card 2 of 2: flashcard');
    expect(calls(reveal(first))).toHaveLength(1);
    expect(calls(reveal(second))).toHaveLength(0);
  });

  it('shortcuts act when focus is on a container around the card, as after a click on the page background', async () => {
    const first = flash(1);
    serve([first]);
    render(
      <App>
        <main tabIndex={-1}>
          <ReviewPage />
        </main>
      </App>,
    );
    await cardHeading('Card 1 of 1: flashcard');
    screen.getByRole('main').focus();
    await userEvent.keyboard(' ');
    expect(await screen.findByText('A measure put in place to reduce risk.')).toBeInTheDocument();
    expect(calls(reveal(first))).toHaveLength(1);
  });

  it('shortcuts act from the page body and from inside the card, and leave a key that something else has handled', async () => {
    const [first, second] = [flash(1), flash(2)];
    serve([first, second]);
    handlers[post(first)] = () => json(200, moved(2, '2026-11-12', 2));
    renderReview();
    const heading = await cardHeading('Card 1 of 2: flashcard');

    // Something else (a dialog, say) took the key first.
    const taken = (e: KeyboardEvent) => e.preventDefault();
    document.addEventListener('keydown', taken, true);
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{Enter}');
    document.removeEventListener('keydown', taken, true);
    expect(calls(reveal(first))).toHaveLength(0);

    // Focus on the card's heading (where it lands when a card arrives): inside the card.
    heading.focus();
    await userEvent.keyboard(' ');
    await screen.findByText('A measure put in place to reduce risk.');
    // Focus on one of the card's own buttons: the other answer's key still works.
    button('I knew it').focus();
    document.addEventListener('keydown', taken, true);
    await userEvent.keyboard('2');
    document.removeEventListener('keydown', taken, true);
    expect(writes()).toEqual([]);
    await userEvent.keyboard('1');
    await cardHeading('Card 2 of 2: flashcard');
    expect(bodies(post(first))).toEqual([{ knewIt: true }]);
  });

  it('a double click on an answer button posts once, and a double click on Show answer does not grade', async () => {
    const [first, second] = [flash(1), flash(2)];
    serve([first, second]);
    const answer = deferred<Response>();
    handlers[post(first)] = () => answer.promise;
    renderReview();
    await cardHeading('Card 1 of 2: flashcard');

    await userEvent.dblClick(button('Show answer'));
    await screen.findByText('A measure put in place to reduce risk.');
    expect(calls(reveal(first))).toHaveLength(1);
    expect(writes()).toEqual([]);

    await userEvent.dblClick(button("I didn't"));
    await userEvent.click(button('I knew it'));
    expect(bodies(post(first))).toEqual([{ knewIt: false }]);

    answer.resolve(json(200, moved(1, '2026-11-11', 0)));
    await cardHeading('Card 2 of 2: flashcard');
    expect(writes()).toEqual([post(first)]);
  });

  it('a term that is one long unbroken word wraps inside the card', async () => {
    serve([flash(1)]);
    renderReview();
    await cardHeading('Card 1 of 1: flashcard');
    expect(within(screen.getByRole('group', { name: 'Flashcard' })).getByText('Security control')).toHaveClass('[overflow-wrap:anywhere]');
  });

  it('the card flips in 3D once the answer is shown', async () => {
    serve([flash(1)]);
    renderReview();
    await cardHeading('Card 1 of 1: flashcard');
    const flipper = screen.getByRole('group', { name: 'Flashcard' }).firstElementChild as HTMLElement;
    expect(flipper.style.transform).not.toContain('rotateY(180deg)');
    await showAnswer();
    await waitFor(() => expect(flipper.style.transform).toContain('rotateY(180deg)'));
  });

  it('review: question card posts the answer and shows feedback before Next', async () => {
    const [first, second] = [questionCard(single), flash(2)];
    serve([first, second]);
    handlers[post(first)] = () => json(200, moved(1, '2026-11-11', 0, { feedback: wrong }));
    renderReview();

    expect(await cardHeading('Card 1 of 2: question')).toBeInTheDocument();
    expect(screen.getAllByText(single.prompt)).toHaveLength(1);
    expect(button('Check')).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Managerial' }));
    await userEvent.click(button('Check'));

    expect(await within(result()).findByText('A firewall rule is enforced by technology.')).toBeInTheDocument();
    expect(within(result()).getByText('Incorrect')).toBeInTheDocument();
    expect(bodies(post(first))).toEqual([{ answer: { type: 'single', choice: 'b' } }]);
    // Still on the same card until Next; the card's new box and date are the server's.
    expect(screen.getByRole('heading', { level: 2, name: 'Card 1 of 2: question' })).toBeInTheDocument();
    expect(screen.getByText(/Back to box 1\. Due again .*\b11\b/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Managerial/ })).toBeDisabled();

    await userEvent.click(button('Next'));
    expect(await cardHeading('Card 2 of 2: flashcard')).toHaveFocus();
    expect(writes()).toEqual([post(first)]);
  });

  it('a double click on Check posts once; an untouched order question sends its served order', async () => {
    const [first, second] = [questionCard(single), questionCard(order)];
    serve([first, second]);
    const answer = deferred<Response>();
    handlers[post(first)] = () => answer.promise;
    handlers[post(second)] = () =>
      json(200, moved(1, '2026-11-11', 0, {
        feedback: { correct: false, fraction: 0, correctAnswer: { type: 'order', order: ['a', 'b', 'c'] }, explanation: 'Request comes first.' },
      }));
    renderReview();
    await cardHeading('Card 1 of 2: question');
    await userEvent.click(screen.getByRole('radio', { name: 'Technical' }));
    await userEvent.dblClick(button('Check'));
    expect(calls(post(first))).toHaveLength(1);

    answer.resolve(json(200, moved(2, '2026-11-12', 2, { feedback: right })));
    expect(await within(result()).findByText('Correct')).toBeInTheDocument();
    expect(screen.getByText(/Now in box 2 of 5\. Due again .*\b12\b/)).toBeInTheDocument();
    await userEvent.click(button('Next'));

    await cardHeading('Card 2 of 2: question');
    await userEvent.click(button('Check'));
    expect(await within(result()).findByText('Request comes first.')).toBeInTheDocument();
    expect(bodies(post(second))).toEqual([{ answer: { type: 'order', order: ['c', 'a', 'b'] } }]);
    expect(button('Finish')).toBeInTheDocument();
  });

  it('review: end screen summarizes counts', async () => {
    const [first, second, third] = [flash(1), flash(2), questionCard(single)];
    serve([first, second, third]);
    handlers[post(first)] = () => json(200, moved(2, '2026-11-12', 2));
    handlers[post(second)] = () => json(200, moved(1, '2026-11-11', 0));
    handlers[post(third)] = () => json(200, moved(3, '2026-11-14', 2, { feedback: right }));
    client.setQueryData(['dashboard'], { xp: 10, level: 1, nextLevelXp: 100, streak: 1 });
    client.setQueryData(['path'], { domains: [] });
    renderReview();

    await cardHeading('Card 1 of 3: flashcard');
    await showAnswer();
    await userEvent.click(button('I knew it'));
    await cardHeading('Card 2 of 3: flashcard');
    await showAnswer();
    await userEvent.click(button("I didn't"));
    await cardHeading('Card 3 of 3: question');
    expect(client.getQueryState(['path'])?.isInvalidated).toBe(false);
    await userEvent.click(screen.getByRole('radio', { name: 'Technical' }));
    await userEvent.click(button('Check'));
    await userEvent.click(await screen.findByRole('button', { name: 'Finish' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Review complete' })).toHaveFocus();
    expect(stat('Cards reviewed')).toHaveTextContent(/^3$/);
    expect(stat('Moved up')).toHaveTextContent(/^2$/);
    expect(stat('Back to box 1')).toHaveTextContent(/^1$/);
    expect(stat('XP earned')).toHaveTextContent(/^4$/);
    // The earliest of the dates the server gave, as a calendar day.
    expect(stat('Next due')).toHaveTextContent(formatDay('2026-11-11'));
    expect(stat('Next due')).toHaveTextContent(/\b11\b/);
    expect(screen.queryByRole('button', { name: /Review more/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to path' })).toHaveAttribute('href', '/');
    // What each review earned went to the rewards provider, once, as it came.
    expect(report.mock.calls).toEqual([[{ xp: 2, newBadges: [] }], [{ xp: 0, newBadges: [] }], [{ xp: 2, newBadges: [] }]]);
    // The path reads its numbers again. The header's are the provider's to read: the round does not ask too.
    expect(client.getQueryState(['path'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['dashboard'])?.isInvalidated).toBe(false);
  });

  it('end screen: "Next due" is the earlier of the round\'s dates and the next date the server reported', async () => {
    const first = flash(1);
    // Another card, not in this round, is due tomorrow; the reviewed one comes back later.
    serve([first], 1, '2026-11-11');
    handlers[post(first)] = () => json(200, moved(3, '2026-11-14', 2));
    const view = renderReview();
    await cardHeading('Card 1 of 1: flashcard');
    await showAnswer();
    await userEvent.click(button('I knew it'));
    await screen.findByRole('heading', { level: 2, name: 'Review complete' });
    expect(stat('Next due')).toHaveTextContent(formatDay('2026-11-11'));
    view.unmount();

    // The other way round: the round's own card comes back first.
    client = createQueryClient();
    serve([first], 1, '2026-11-20');
    renderReview();
    await cardHeading('Card 1 of 1: flashcard');
    await showAnswer();
    await userEvent.click(button('I knew it'));
    await screen.findByRole('heading', { level: 2, name: 'Review complete' });
    expect(stat('Next due')).toHaveTextContent(formatDay('2026-11-14'));
  });

  it('end screen: a card counts as moved up only when its box is higher than before', async () => {
    const [first, second, third] = [flash(1), flash(2), flash(3)];
    serve([first, second, third]);
    // Right, but already in the last box; right, from box 1; wrong, from box 3.
    handlers[post(first)] = () => json(200, moved(5, '2026-11-26', 2, { previousBox: 5 }));
    handlers[post(second)] = () => json(200, moved(2, '2026-11-12', 2, { previousBox: 1 }));
    handlers[post(third)] = () => json(200, moved(1, '2026-11-11', 0, { previousBox: 3 }));
    renderReview();
    for (const [n, answer] of [[1, 'I knew it'], [2, 'I knew it'], [3, "I didn't"]] as const) {
      await cardHeading(`Card ${n} of 3: flashcard`);
      await showAnswer();
      await userEvent.click(button(answer));
    }
    await screen.findByRole('heading', { level: 2, name: 'Review complete' });
    expect(stat('Cards reviewed')).toHaveTextContent(/^3$/);
    expect(stat('Moved up')).toHaveTextContent(/^1$/);
    expect(stat('Stayed in box 5')).toHaveTextContent(/^1$/);
    expect(stat('Back to box 1')).toHaveTextContent(/^1$/);
  });

  it('a badge earned by a review is reported with its XP, also when there is none', async () => {
    const [first, second] = [flash(1), flash(2)];
    serve([first, second]);
    // No XP (a second right answer on the same day), but the hundredth correct attempt.
    handlers[post(first)] = () => json(200, moved(2, '2026-11-12', 0, { newBadges: ['hundred-correct'] }));
    renderReview();
    await cardHeading('Card 1 of 2: flashcard');
    await showAnswer();
    await userEvent.click(button('I knew it'));
    await cardHeading('Card 2 of 2: flashcard');
    expect(report.mock.calls).toEqual([[{ xp: 0, newBadges: ['hundred-correct'] }]]);
  });

  it('a response that arrives after the learner has left the page is still reported, once', async () => {
    const first = flash(1);
    serve([first]);
    const answer = deferred<Response>();
    handlers[post(first)] = () => answer.promise;
    const view = renderReview();
    await cardHeading('Card 1 of 1: flashcard');
    await showAnswer();
    await userEvent.click(button('I knew it'));
    expect(calls(post(first))).toHaveLength(1);
    view.unmount();

    answer.resolve(json(200, moved(2, '2026-11-12', 2, { newBadges: ['streak-3'] })));
    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    expect(report).toHaveBeenCalledWith({ xp: 2, newBadges: ['streak-3'] });
    await new Promise((r) => setTimeout(r, 20));
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('with the real rewards provider, the end of a round asks for no read of the dashboard of its own', async () => {
    const [first, second] = [flash(1), flash(2)];
    serve([first, second]);
    handlers[post(first)] = () => json(200, moved(2, '2026-11-12', 2));
    handlers[post(second)] = () => json(200, moved(2, '2026-11-12', 2, { newBadges: ['streak-3'] }));
    const totals = (xp: number): DashboardResponse => ({
      xp, level: 1, nextLevelXp: 100, streak: 3, reviewsDue: 0, domains: [], weakest: [], mockHistory: [],
      readiness: { ready: false, missing: [] }, studyPlan: null, openMock: null, mockSpec: { questions: 11, minutes: 11, partial: true },
      badges: [{ id: 'streak-3', title: 'Three-Day Streak', description: 'Study three days in a row.', earnedAt: null }],
    });
    let xp = 10;
    handlers['GET /api/dashboard'] = () => json(200, totals(xp));
    render(
      <App
        rewards={(page) => (
          <RewardsProvider>
            <RewardsBanner />
            {page}
          </RewardsProvider>
        )}
      >
        {routes}
      </App>,
    );
    await cardHeading('Card 1 of 2: flashcard');
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(1));

    await showAnswer();
    xp = 12;
    await userEvent.click(button('I knew it'));
    await cardHeading('Card 2 of 2: flashcard');
    await showAnswer();
    xp = 14;
    await userEvent.click(button('I knew it'));
    await screen.findByRole('heading', { level: 2, name: 'Review complete' });
    // The badge is celebrated. In this test the two reviews follow each other within milliseconds, so
    // their reports share one read; a learner's reviews are at least half a second apart (the press
    // guard), and each has its own. What matters here: the end of the round asks for no read of its own.
    expect(await screen.findByText('Three-Day Streak')).toBeInTheDocument();
    await waitFor(() => expect(calls('GET /api/dashboard')).toHaveLength(2));
    await new Promise((r) => setTimeout(r, REFRESH_DELAY_MS + 100));
    expect(calls('GET /api/dashboard')).toHaveLength(2);
    expect(client.getQueryData<DashboardResponse>(['dashboard'])?.xp).toBe(14);
  });

  it('"Show answer" says that the answer is loading, keeps focus and asks once', async () => {
    const first = flash(1);
    serve([first]);
    const answer = deferred<Response>();
    handlers[reveal(first)] = () => answer.promise;
    renderReview();
    await cardHeading('Card 1 of 1: flashcard');
    await userEvent.click(button('Show answer'));

    const busy = await screen.findByRole('button', { name: 'Loading the answer…' });
    expect(busy).toHaveFocus();
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled(); // a disabled button would drop keyboard focus
    expect(screen.getByRole('status', { name: 'Card activity' })).toHaveTextContent('Loading the answer…');
    await userEvent.click(busy);
    await userEvent.keyboard('{Enter}');
    expect(calls(reveal(first))).toHaveLength(1);

    answer.resolve(json(200, { definition: DEFINITIONS['f-1.1-001'] }));
    expect(await screen.findByText('A measure put in place to reduce risk.')).toHaveFocus();
    expect(screen.getByRole('status', { name: 'Card activity' })).toBeEmptyDOMElement();
  });

  it('a late answer to a card that was skipped meanwhile does not move the round backwards', async () => {
    const [first, second, third] = [flash(1), flash(2), flash(3)];
    serve([first, second, third]);
    const retry = deferred<Response>();
    let attempts = 0;
    handlers[post(first)] = () => (attempts++ === 0 ? json(500, { error: 'Internal error' }) : retry.promise);
    handlers[post(second)] = () => json(200, moved(2, '2026-11-12', 2));
    renderReview();
    await cardHeading('Card 1 of 3: flashcard');
    await showAnswer();
    await userEvent.click(button('I knew it'));
    await screen.findByRole('alert');
    // Retry, then lose patience and skip while the retry is still on its way.
    await userEvent.click(button('Try again'));
    await userEvent.click(button('Skip this card'));
    await cardHeading('Card 2 of 3: flashcard');
    await showAnswer();
    await userEvent.click(button('I knew it'));
    await cardHeading('Card 3 of 3: flashcard');

    retry.resolve(json(200, moved(2, '2026-11-12', 2)));
    await waitFor(() => expect(calls(post(first))).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole('heading', { level: 2, name: 'Card 3 of 3: flashcard' })).toBeInTheDocument();
    expect(screen.getByText('Control type')).toBeInTheDocument();

    // The late answer still counts: the server did move that card.
    await userEvent.click(button('Show answer'));
    handlers[post(third)] = () => json(200, moved(1, '2026-11-11', 0));
    await userEvent.click(await screen.findByRole('button', { name: "I didn't" }));
    await screen.findByRole('heading', { level: 2, name: 'Review complete' });
    expect(stat('Cards reviewed')).toHaveTextContent(/^3$/);
    expect(screen.queryByText('Skipped')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review more' })).not.toBeInTheDocument();
  });

  it('a card skipped after a server failure is still due: the summary offers it again', async () => {
    const [first, second, third] = [flash(1), flash(2), flash(3)];
    serve([first, second, third]);
    handlers[post(first)] = () => json(500, { error: 'Internal error' });
    handlers[reveal(second)] = () => json(404, { error: 'Card not found' });
    handlers[post(third)] = () => json(200, moved(2, '2026-11-12', 2));
    renderReview();
    await cardHeading('Card 1 of 3: flashcard');
    await showAnswer();
    await userEvent.click(button('I knew it'));
    await userEvent.click(await screen.findByRole('button', { name: 'Skip this card' }));
    // A card that is gone is skipped too, but it is not due any more.
    await cardHeading('Card 2 of 3: flashcard');
    await userEvent.click(button('Show answer'));
    await userEvent.click(await screen.findByRole('button', { name: 'Skip this card' }));
    await cardHeading('Card 3 of 3: flashcard');
    await showAnswer();
    await userEvent.click(button('I knew it'));

    await screen.findByRole('heading', { level: 2, name: 'Review complete' });
    expect(stat('Skipped')).toHaveTextContent(/^2$/);
    expect(screen.getByText('1 more card is due today.')).toBeInTheDocument();

    // "Review more" says that it is loading, keeps focus and asks once.
    const more = deferred<Response>();
    handlers[DUE] = () => more.promise;
    await userEvent.click(button('Review more'));
    const busy = await screen.findByRole('button', { name: 'Loading more cards…' });
    expect(busy).toHaveFocus();
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled();
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveTextContent('Loading more cards…');
    await userEvent.click(busy);
    expect(calls(DUE)).toHaveLength(2);
    more.resolve(json(200, due([first], 1)));
    expect(await cardHeading('Card 1 of 1: flashcard')).toHaveFocus();
  });

  it('keeps the card and the answer when the server cannot be reached, and retries on request', async () => {
    const [first, second] = [flash(1), questionCard(single)];
    serve([first, second]);
    let online = false;
    handlers[reveal(first)] = () => (online ? json(200, { definition: DEFINITIONS['f-1.1-001'] }) : Promise.reject(new TypeError('offline')));
    handlers[post(first)] = () => (online ? json(200, moved(1, '2026-11-11', 0)) : json(503, { error: 'Unavailable' }));
    handlers[post(second)] = () => (online ? json(200, moved(2, '2026-11-12', 2, { feedback: right })) : Promise.reject(new TypeError('offline')));
    renderReview();
    await cardHeading('Card 1 of 2: flashcard');

    await userEvent.click(button('Show answer'));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the answer.");
    expect(screen.getByText('Security control')).toBeInTheDocument();
    online = true;
    await userEvent.click(button('Show answer'));
    await screen.findByText('A measure put in place to reduce risk.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    online = false;
    await userEvent.click(button("I didn't"));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save your answer");
    // Still the same card, still revealed.
    expect(screen.getByRole('heading', { level: 2, name: 'Card 1 of 2: flashcard' })).toBeInTheDocument();
    expect(screen.getByText('A measure put in place to reduce risk.')).toBeInTheDocument();
    online = true;
    await userEvent.click(button('Try again'));
    await cardHeading('Card 2 of 2: question');
    expect(bodies(post(first))).toEqual([{ knewIt: false }, { knewIt: false }]);

    online = false;
    await userEvent.click(screen.getByRole('radio', { name: 'Technical' }));
    await userEvent.click(button('Check'));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send your answer. It has not been marked yet.");
    expect(screen.getByRole('radio', { name: 'Technical' })).toBeChecked();
    expect(screen.getByRole('heading', { level: 2, name: 'Card 2 of 2: question' })).toBeInTheDocument();
    online = true;
    await userEvent.click(button('Try again'));
    expect(await within(result()).findByText('Correct')).toBeInTheDocument();
    expect(bodies(post(second))).toEqual([{ answer: { type: 'single', choice: 'a' } }, { answer: { type: 'single', choice: 'a' } }]);
  });

  it('a card that is gone or no longer due is skipped, not retried, and is not counted as reviewed', async () => {
    const [first, second, third] = [flash(1), questionCard(single), flash(3)];
    serve([first, second, third]);
    handlers[reveal(first)] = () => json(404, { error: 'Card not found' });
    handlers[post(second)] = () => json(409, { error: 'This card is not due yet' });
    handlers[post(third)] = () => json(200, moved(2, '2026-11-12', 2));
    renderReview();
    await cardHeading('Card 1 of 3: flashcard');

    await userEvent.click(button('Show answer'));
    expect(await screen.findByRole('alert')).toHaveTextContent('This card is no longer available.');
    expect(screen.queryByRole('button', { name: 'Show answer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    // The button that was pressed is gone: focus is on the way forward, not lost.
    expect(button('Skip this card')).toHaveFocus();
    // The shortcut does not hammer a card that cannot be shown.
    button('Skip this card').blur();
    await userEvent.keyboard(' ');
    expect(calls(reveal(first))).toHaveLength(1);
    await userEvent.click(button('Skip this card'));

    await cardHeading('Card 2 of 3: question');
    await userEvent.click(screen.getByRole('radio', { name: 'Technical' }));
    await userEvent.click(button('Check'));
    expect(await screen.findByRole('alert')).toHaveTextContent('This card has already been reviewed');
    expect(screen.queryByRole('button', { name: /Check|Try again/ })).not.toBeInTheDocument();
    expect(button('Skip this card')).toHaveFocus();
    await userEvent.click(button('Skip this card'));

    expect(await cardHeading('Card 3 of 3: flashcard')).toHaveFocus();
    await showAnswer();
    await userEvent.click(button('I knew it'));
    await screen.findByRole('heading', { level: 2, name: 'Review complete' });
    expect(stat('Cards reviewed')).toHaveTextContent(/^1$/);
    expect(stat('Moved up')).toHaveTextContent(/^1$/);
    expect(stat('Skipped')).toHaveTextContent(/^2$/);
  });

  it('offers the rest when more cards are due than one round holds', async () => {
    const first = flash(1);
    serve([first], 31);
    handlers[post(first)] = () => json(200, moved(2, '2026-11-12', 2));
    renderReview();
    await cardHeading('Card 1 of 1: flashcard');
    expect(screen.getByText('31 cards are due today. This round has 1.')).toBeInTheDocument();
    await showAnswer();
    await userEvent.click(button('I knew it'));
    await screen.findByRole('heading', { level: 2, name: 'Review complete' });
    expect(screen.getByText('30 more cards are due today.')).toBeInTheDocument();

    const second = flash(2);
    serve([second], 30);
    await userEvent.click(button('Review more'));
    expect(await cardHeading('Card 1 of 1: flashcard')).toHaveFocus();
    expect(screen.getByText('Control category')).toBeInTheDocument();
    expect(calls(DUE)).toHaveLength(2);
  });

  it('offers both a retry and a way past a card when the server fails in a way that may repeat', async () => {
    const [first, second] = [flash(1), flash(2)];
    serve([first, second]);
    handlers[post(first)] = () => json(500, { error: 'Internal error' });
    renderReview();
    await cardHeading('Card 1 of 2: flashcard');
    await showAnswer();
    await userEvent.click(button('I knew it'));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save your answer");
    expect(button('Try again')).toBeInTheDocument();
    await userEvent.click(button('Skip this card'));
    expect(await cardHeading('Card 2 of 2: flashcard')).toHaveFocus();
    expect(calls(post(first))).toHaveLength(1);
  });

  it('marks the path for a refresh when a round is left half way; a review that earned nothing asks nothing of the header', async () => {
    const [first, second] = [flash(1), flash(2)];
    serve([first, second]);
    handlers[post(first)] = () => json(200, moved(1, '2026-11-11', 0));
    client.setQueryData(['dashboard'], { xp: 10, level: 1, nextLevelXp: 100, streak: 1 });
    client.setQueryData(['path'], { domains: [] });
    const view = renderReview();
    await cardHeading('Card 1 of 2: flashcard');
    await showAnswer();
    await userEvent.click(button("I didn't"));
    await cardHeading('Card 2 of 2: flashcard');
    expect(client.getQueryState(['path'])?.isInvalidated).toBe(false);
    view.unmount();
    expect(client.getQueryState(['path'])?.isInvalidated).toBe(true);
    // The XP, the level and the streak in the header change with XP only.
    expect(report.mock.calls).toEqual([[{ xp: 0, newBadges: [] }]]);
    expect(client.getQueryState(['dashboard'])?.isInvalidated).toBe(false);
  });

  it('keeps the summary and says so when the next round cannot be loaded', async () => {
    const first = flash(1);
    serve([first], 31);
    handlers[post(first)] = () => json(200, moved(2, '2026-11-12', 2));
    renderReview();
    await cardHeading('Card 1 of 1: flashcard');
    await showAnswer();
    await userEvent.click(button('I knew it'));
    await screen.findByRole('heading', { level: 2, name: 'Review complete' });
    handlers[DUE] = () => json(500, { error: 'Internal error' });
    await userEvent.click(button('Review more'));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load more cards. Try again.");
    expect(stat('Cards reviewed')).toHaveTextContent(/^1$/);
  });

  it('says so when the cards cannot be loaded, with a retry', async () => {
    handlers[DUE] = () => json(500, { error: 'Internal error' });
    renderReview();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your review cards.");
    serve([]);
    await userEvent.click(button('Try again'));
    expect(await screen.findByText(/Nothing due today\./)).toBeInTheDocument();
  });

});

// Ordinary presses, sent straight after the button under them has changed. Time stands still unless the
// test moves it, so each press is inside or outside the settle window exactly as written.
describe('review: a press that lands on a button which has just appeared', () => {
  it('"Show answer" pressed twice does not grade the card unseen', async () => {
    const clock = holdPressClock();
    const [first, second] = [flash(1), flash(2)];
    serve([first, second]);
    handlers[post(first)] = () => json(200, moved(2, '2026-11-12', 2));
    renderReview();
    await cardHeading('Card 1 of 2: flashcard');
    clock.advance(SETTLE_MS);

    await userEvent.click(button('Show answer'));
    // "I knew it" is now where "Show answer" was; the second press lands on it.
    const knewIt = await screen.findByRole('button', { name: 'I knew it' });
    await userEvent.click(knewIt);
    await userEvent.click(button("I didn't"));
    clock.advance(SETTLE_MS - 1);
    await userEvent.click(knewIt);
    expect(writes()).toEqual([]);
    // Nothing else came of the ignored presses: the card is still open, and the button is not switched off.
    expect(screen.getByRole('heading', { level: 2, name: 'Card 1 of 2: flashcard' })).toBeInTheDocument();
    expect(knewIt).toBeEnabled();
    expect(knewIt).not.toHaveAttribute('aria-disabled', 'true');
    expect(knewIt).toHaveFocus();

    clock.advance(1);
    await userEvent.click(knewIt);
    await cardHeading('Card 2 of 2: flashcard');
    expect(bodies(post(first))).toEqual([{ knewIt: true }]);

    // "Show answer" on the new card is open at once: showing an answer grades nothing, and a learner who
    // knows the term at a glance must not lose the press. What it brings is closed again for a moment.
    await userEvent.click(button('Show answer'));
    expect(await screen.findByText('How a control is implemented.')).toBeInTheDocument();
    expect(calls(reveal(second))).toHaveLength(1);
    await userEvent.click(button('I knew it'));
    clock.advance(SETTLE_MS - 1);
    await userEvent.click(button("I didn't"));
    expect(writes()).toEqual([post(first)]);
  });

  it('the shortcut keys keep to the same pause: a key straight after the answer appears does not grade', async () => {
    const clock = holdPressClock();
    const [first, second] = [flash(1), flash(2)];
    serve([first, second]);
    handlers[post(first)] = () => json(200, moved(1, '2026-11-11', 0));
    renderReview();
    await cardHeading('Card 1 of 2: flashcard');

    // Space shows the answer of a card straight away, also when the card has only just appeared.
    await userEvent.keyboard(' ');
    await screen.findByText('A measure put in place to reduce risk.');
    expect(calls(reveal(first))).toHaveLength(1);

    await userEvent.keyboard('1');
    await userEvent.keyboard('2');
    clock.advance(SETTLE_MS - 1);
    await userEvent.keyboard('1');
    expect(writes()).toEqual([]);
    clock.advance(1);
    await userEvent.keyboard('2');
    await cardHeading('Card 2 of 2: flashcard');
    expect(bodies(post(first))).toEqual([{ knewIt: false }]);

    // The key that follows at once shows the next card's answer (nothing is graded by that), and the
    // grading keys are closed again for a moment after it.
    await userEvent.keyboard('{Enter}');
    await screen.findByText('How a control is implemented.');
    await userEvent.keyboard('1');
    clock.advance(SETTLE_MS - 1);
    await userEvent.keyboard('2');
    expect(writes()).toEqual([post(first)]);
  });

  it('Check then an immediate second press does not skip the feedback, and Next then an immediate press does not grade an untouched order question', async () => {
    const clock = holdPressClock();
    const [first, second] = [questionCard(single), questionCard(order)];
    serve([first, second]);
    handlers[post(first)] = () => json(200, moved(2, '2026-11-12', 2, { feedback: right }));
    handlers[post(second)] = () =>
      json(200, moved(1, '2026-11-11', 0, {
        feedback: { correct: false, fraction: 0, correctAnswer: { type: 'order', order: ['a', 'b', 'c'] }, explanation: 'Request comes first.' },
      }));
    renderReview();
    await cardHeading('Card 1 of 2: question');
    clock.advance(SETTLE_MS);
    await userEvent.click(screen.getByRole('radio', { name: 'Technical' }));
    await userEvent.click(button('Check'));

    // "Next" is now where "Check" was.
    const next = await screen.findByRole('button', { name: 'Next' });
    await userEvent.click(next);
    clock.advance(SETTLE_MS - 1);
    await userEvent.click(next);
    expect(screen.getByRole('heading', { level: 2, name: 'Card 1 of 2: question' })).toBeInTheDocument();
    expect(within(result()).getByText('Correct')).toBeInTheDocument();
    expect(next).toBeEnabled();

    clock.advance(1);
    await userEvent.click(next);
    await cardHeading('Card 2 of 2: question');
    // The order question is complete as it was served: its Check is live, and must not be pressed unseen.
    expect(button('Check')).toBeEnabled();
    await userEvent.click(button('Check'));
    clock.advance(SETTLE_MS - 1);
    await userEvent.click(button('Check'));
    expect(calls(post(second))).toHaveLength(0);
    expect(result()).toBeEmptyDOMElement();

    clock.advance(1);
    await userEvent.click(button('Check'));
    expect(await within(result()).findByText('Request comes first.')).toBeInTheDocument();
    expect(calls(post(second))).toHaveLength(1);
  });

  it('a press that is handled after the answer came back, and before the card has shown it, does not review the card again', async () => {
    const clock = holdPressClock();
    const [first, second] = [questionCard(single), flash(2)];
    serve([first, second]);
    const answer = deferred<Response>();
    handlers[post(first)] = () => answer.promise;
    renderReview();
    await cardHeading('Card 1 of 2: question');
    clock.advance(SETTLE_MS);
    await userEvent.click(screen.getByRole('radio', { name: 'Technical' }));
    const check = button('Check');
    await userEvent.click(check);
    expect(calls(post(first))).toHaveLength(1);

    // Inside one `act` nothing is rendered until it ends: the response is handled, and the button on
    // screen is still "Check", as in the moment before React shows the feedback.
    await act(async () => {
      answer.resolve(json(200, moved(2, '2026-11-12', 2, { feedback: right })));
      await new Promise((r) => setTimeout(r, 20));
      fireEvent.click(check);
      fireEvent.click(check);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(calls(post(first))).toHaveLength(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(within(result()).getByText('Correct')).toBeInTheDocument();
  });

  it('a press straight after a card could not be saved does not skip it, and one straight after the summary appears does not load more', async () => {
    const clock = holdPressClock();
    const first = flash(1);
    serve([first], 31);
    handlers[post(first)] = () => json(500, { error: 'Internal error' });
    renderReview();
    await cardHeading('Card 1 of 1: flashcard');
    clock.advance(SETTLE_MS);
    await userEvent.click(button('Show answer'));
    await screen.findByRole('button', { name: 'I knew it' });
    clock.advance(SETTLE_MS);
    await userEvent.click(button('I knew it'));

    // The note with "Try again" and "Skip this card" appears where the answer buttons were.
    const skip = await screen.findByRole('button', { name: 'Skip this card' });
    await userEvent.click(skip);
    await userEvent.click(button('Try again'));
    expect(screen.getByRole('heading', { level: 2, name: 'Card 1 of 1: flashcard' })).toBeInTheDocument();
    expect(calls(post(first))).toHaveLength(1);

    clock.advance(SETTLE_MS);
    await userEvent.click(skip);
    await screen.findByRole('heading', { level: 2, name: 'Review complete' });
    await userEvent.click(button('Review more'));
    expect(calls(DUE)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Loading more cards…' })).not.toBeInTheDocument();

    clock.advance(SETTLE_MS);
    serve([flash(2)], 30);
    await userEvent.click(button('Review more'));
    await cardHeading('Card 1 of 1: flashcard');
    expect(calls(DUE)).toHaveLength(2);
  });
});
