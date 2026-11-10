import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feedback, PublicQuestion } from '../../../../shared/types';
import type { ReviewCard, ReviewDueResponse, ReviewResponse } from '../../api/types';
import { createQueryClient } from '../../queryClient';
import { formatDay, ReviewPage } from './ReviewPage';

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
const due = (cards: ReviewCard[], total = cards.length): ReviewDueResponse => ({ total, cards });

const enc = encodeURIComponent;
const DUE = 'GET /api/review/due';
const reveal = (card: ReviewCard) => `GET /api/review/flashcard/${enc(card.cardId)}`;
const post = (card: ReviewCard) => `POST /api/review/${enc(card.cardId)}`;

/** What the server answers when a card is reviewed. */
const moved = (box: number, dueOn: string, xp: number, more: Partial<ReviewResponse> = {}): ReviewResponse => ({ box, dueOn, xp, ...more });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handlers: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;

const keyOf = (url: unknown, init?: RequestInit) => `${init?.method ?? 'GET'} ${String(url)}`;
const calls = (key: string) => fetchMock.mock.calls.filter(([u, i]) => keyOf(u, i) === key);
const bodies = (key: string) => calls(key).map(([, i]) => JSON.parse(String(i.body)));
const writes = () => fetchMock.mock.calls.map(([u, i]) => keyOf(u, i)).filter((k) => !k.startsWith('GET'));

/** Serves the cards as due, with a definition for every flashcard among them. */
function serve(cards: ReviewCard[], total = cards.length) {
  handlers[DUE] = () => json(200, due(cards, total));
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
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function renderReview() {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/review']}>
        <Routes>
          <Route path="/" element={<p>path screen</p>} />
          <Route path="/review" element={<ReviewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
    serve([]);
    renderReview();
    expect(await screen.findByText(/Nothing due today\./)).toBeInTheDocument();
    // The API does not say when the next card is due, so no date is made up.
    expect(screen.queryByText(/Next review/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to path' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/review']}>
          <label>
            Notes <input />
          </label>
          <button type="button">Elsewhere</button>
          <a href="/somewhere">A link</a>
          <ReviewPage />
        </MemoryRouter>
      </QueryClientProvider>,
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
    // The second half of a double click that lands on a button which has just appeared is ignored.
    fireEvent.click(button('I knew it'), { detail: 2 });
    expect(writes()).toEqual([]);

    await userEvent.dblClick(button("I didn't"));
    await userEvent.click(button('I knew it'));
    expect(bodies(post(first))).toEqual([{ knewIt: false }]);

    answer.resolve(json(200, moved(1, '2026-11-11', 0)));
    await cardHeading('Card 2 of 2: flashcard');
    expect(writes()).toEqual([post(first)]);
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

  it('a double click on Check posts once and does not skip the feedback; an untouched order question sends its served order', async () => {
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
    fireEvent.click(button('Next'), { detail: 2 });
    expect(screen.getByRole('heading', { level: 2, name: 'Card 1 of 2: question' })).toBeInTheDocument();
    fireEvent.click(button('Next'), { detail: 1 });

    await cardHeading('Card 2 of 2: question');
    // A stray extra click that lands on the next card's Check does not grade it.
    fireEvent.click(button('Check'), { detail: 2 });
    expect(calls(post(second))).toHaveLength(0);
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
    // The header and the path read their numbers again.
    expect(client.getQueryState(['dashboard'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['path'])?.isInvalidated).toBe(true);
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

  it('refreshes the header and the path when a round is left half way', async () => {
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
    expect(client.getQueryState(['dashboard'])?.isInvalidated).toBe(false);
    view.unmount();
    expect(client.getQueryState(['dashboard'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['path'])?.isInvalidated).toBe(true);
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

  it('shows a server date as the same calendar day in any time zone', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    // The zone really is in force here: read as an instant, the date would land on the day before.
    expect(new Date('2026-11-01').getDate()).toBe(31);
    for (const zone of ['America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
      vi.stubEnv('TZ', zone);
      const text = formatDay('2026-11-01');
      expect(text).toMatch(/\b1\b/);
      expect(text).not.toMatch(/31/);
      expect(text).toBe(new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(Date.UTC(2026, 10, 1)));
    }
    // Something that is not a date is shown as it came, not as "Invalid Date".
    expect(formatDay('soon')).toBe('soon');
  });
});
