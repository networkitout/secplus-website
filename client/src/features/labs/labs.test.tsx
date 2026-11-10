import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feedback, PublicQuestion } from '../../../../shared/types';
import type { LabSubmitResponse, LabSummary, LabView, PathDomain, PathResponse } from '../../api/types';
import { createQueryClient } from '../../queryClient';
import { LabPage } from './LabPage';
import { LabsPage } from './LabsPage';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const s1: PublicQuestion = {
  id: 'lab-1-01-s1', objective: '1.1', difficulty: 1, type: 'single',
  prompt: 'Which category is the door lock?',
  options: [
    { id: 'a', text: 'Technical' },
    { id: 'b', text: 'Physical' },
  ],
};
const s2: PublicQuestion = {
  id: 'lab-1-01-s2', objective: '1.1', difficulty: 2, type: 'multi',
  prompt: 'Which two controls are detective? (Choose two.)',
  options: [
    { id: 'a', text: 'Log review' },
    { id: 'b', text: 'Fence' },
    { id: 'c', text: 'Camera' },
  ],
};
const s3: PublicQuestion = {
  id: 'lab-1-01-s3', objective: '1.1', difficulty: 2, type: 'order',
  prompt: 'Put the review steps in order.',
  items: [
    { id: 'i2', text: 'Classify' },
    { id: 'i1', text: 'List' },
    { id: 'i3', text: 'Report' },
  ],
};

const lab: LabView = {
  id: 'lab-1-01',
  title: 'Classify the controls',
  scenario: 'Fernhill Family Clinic has asked for a review of its controls.',
  steps: [s1, s2, s3],
};

const feedback = (correct: boolean, explanation: string, fraction = correct ? 1 : 0): Feedback => ({
  correct, fraction, explanation, correctAnswer: { type: 'single', choice: 'b' }, why: {},
});
const submitted = (over: Partial<LabSubmitResponse> = {}): LabSubmitResponse => ({
  scorePct: 83.33,
  passed: true,
  steps: {
    'lab-1-01-s1': feedback(true, 'A lock is something you can touch.'),
    'lab-1-01-s2': { ...feedback(true, 'Both notice an event.'), correctAnswer: { type: 'multi', choices: ['a', 'c'] } },
    'lab-1-01-s3': { correct: false, fraction: 0.5, explanation: 'List first, then classify.', correctAnswer: { type: 'order', order: ['i1', 'i2', 'i3'] } },
  },
  xp: 105,
  newBadges: [],
  ...over,
});

const summary = (over: Partial<LabSummary>): LabSummary => ({
  id: 'lab-1-01', domain: 1, title: 'Classify the controls', objectives: ['1.1'], available: true, bestScore: null, passed: false, ...over,
});

const domain = (id: number, unlocked: boolean, done: string[]): PathDomain => ({
  id, title: id === 1 ? 'General Security Concepts' : 'Threats and Mitigations', weight: 12, unlocked, examPassed: false, hasContent: true,
  objectives: [1, 2, 3].map((n) => ({
    id: `${id}.${n}`, title: `Title of ${id}.${n}`, published: true, lessonDone: done.includes(`${id}.${n}`), quizPassed: false, mastery: 0,
  })),
});
const path = (done: string[] = ['1.1', '1.2']): PathResponse => ({ domains: [domain(1, true, done), domain(2, false, done)] });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handlers: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;

const keyOf = (url: unknown, init?: RequestInit) => `${init?.method ?? 'GET'} ${String(url)}`;
const calls = (key: string) => fetchMock.mock.calls.filter(([u, i]) => keyOf(u, i) === key);
const bodies = (key: string) => calls(key).map(([, i]) => JSON.parse(String(i.body)));

const LIST = 'GET /api/labs';
const LAB = 'GET /api/labs/lab-1-01';
const SUBMIT = 'POST /api/labs/lab-1-01/submit';

beforeEach(() => {
  handlers = {
    [LAB]: () => json(200, lab),
    'GET /api/path': () => json(200, path()),
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const h = handlers[keyOf(url, init)];
    if (!h) throw new Error(`unexpected request ${keyOf(url, init)}`);
    return h(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  client = createQueryClient();
});
afterEach(() => vi.unstubAllGlobals());

function renderAt(route: string) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/" element={<p>path screen</p>} />
          <Route path="/labs" element={<LabsPage />} />
          <Route path="/labs/:id" element={<LabPage />} />
          <Route path="/lesson/:objective" element={<p>lesson screen</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const step = (n: number) => screen.getByRole('region', { name: new RegExp(`^Step ${n} of 3`) });
const result = (n: number) => within(step(n)).getByRole('status', { name: 'Result' });

/** Opens the lab and answers its two steps that need an answer (the order step is complete as served). */
async function answerAll() {
  renderAt('/labs/lab-1-01');
  await screen.findByRole('heading', { level: 1, name: 'Classify the controls' });
  await userEvent.click(screen.getByRole('radio', { name: 'Physical' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Log review' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Camera' }));
}

const ANSWERS = {
  answers: {
    'lab-1-01-s1': { type: 'single', choice: 'b' },
    'lab-1-01-s2': { type: 'multi', choices: ['a', 'c'] },
    'lab-1-01-s3': { type: 'order', order: ['i2', 'i1', 'i3'] },
  },
};

describe('labs', () => {
  it('labs list: unavailable lab is not a link and names the lessons required', async () => {
    handlers[LIST] = () =>
      json(200, {
        labs: [
          summary({ bestScore: 89.99, passed: true }),
          summary({ id: 'lab-1-02', title: 'Plan the firewall change', objectives: ['1.3', '1.2'], available: false }),
          summary({ id: 'lab-1-03', title: 'Secure the new web portal', objectives: ['1.2'] }),
          summary({ id: 'lab-2-01', domain: 2, title: 'Triage the alerts', objectives: ['2.1'], available: false }),
        ],
      });
    renderAt('/labs');

    const first = within(await screen.findByRole('region', { name: 'Domain 1: General Security Concepts' }));
    expect(first.getByRole('link', { name: 'Classify the controls' })).toHaveAttribute('href', '/labs/lab-1-01');
    const done = first.getByRole('link', { name: 'Classify the controls' }).closest('li')!;
    // Never rounded up, and the outcome is in words.
    expect(done).toHaveTextContent('Best score: 89%');
    expect(done).toHaveTextContent('Passed');
    expect(first.getByRole('link', { name: 'Secure the new web portal' }).closest('li')).toHaveTextContent('Not attempted yet');

    expect(first.queryByRole('link', { name: /Plan the firewall change/ })).not.toBeInTheDocument();
    const locked = first.getByRole('heading', { level: 3, name: /Plan the firewall change/ }).closest('li')!;
    expect(locked).toHaveTextContent('Locked');
    expect(locked).toHaveTextContent('Finish these lessons to open this lab:');
    const lessons = within(locked).getAllByRole('listitem');
    expect(lessons).toHaveLength(2);
    expect(lessons[0]).toHaveTextContent(/^1\.3 Title of 1\.3\W*Lesson not done$/);
    expect(lessons[1]).toHaveTextContent(/^1\.2 Title of 1\.2\W*Lesson done$/);
    // The way forward: the lessons themselves are links.
    expect(within(locked).getByRole('link', { name: '1.3 Title of 1.3' })).toHaveAttribute('href', '/lesson/1.3');

    // A lab of a locked domain says what unlocks the domain, and its lessons are not links.
    const second = within(screen.getByRole('region', { name: 'Domain 2: Threats and Mitigations' }));
    const far = second.getByRole('heading', { level: 3, name: /Triage the alerts/ }).closest('li')!;
    expect(far).toHaveTextContent('Pass the Domain 1 exam to unlock Domain 2.');
    expect(far).toHaveTextContent('2.1 Title of 2.1');
    expect(within(far).queryByRole('link')).not.toBeInTheDocument();
  });

  it('labs list: names the lessons by number when the path cannot be read', async () => {
    handlers[LIST] = () => json(200, { labs: [summary({ id: 'lab-1-02', title: 'Plan the firewall change', objectives: ['1.3', '1.2'], available: false })] });
    handlers['GET /api/path'] = () => json(500, { error: 'Internal error' });
    renderAt('/labs');
    const section = within(await screen.findByRole('region', { name: 'Domain 1' }));
    expect(section.queryByRole('link')).not.toBeInTheDocument();
    expect(section.getAllByRole('listitem').slice(1).map((li) => li.textContent)).toEqual(['Lesson 1.3', 'Lesson 1.2']);
  });

  it('lab: Submit disabled until all steps complete; results show per-step feedback and Passed at >= 80', async () => {
    handlers[SUBMIT] = () => json(200, submitted({ scorePct: 80 }));
    client.setQueryData(['dashboard'], { xp: 10, level: 1, nextLevelXp: 100, streak: 1 });
    client.setQueryData(['path'], path());
    client.setQueryData(['labs'], { labs: [summary({})] });
    renderAt('/labs/lab-1-01');

    expect(await screen.findByRole('heading', { level: 1, name: 'Classify the controls' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Scenario' })).getByText(lab.scenario)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Scenario', 'Step 1 of 3', 'Step 2 of 3', 'Step 3 of 3']);
    expect(screen.getAllByText(s1.prompt)).toHaveLength(1);

    expect(button('Submit lab')).toBeDisabled();
    expect(button('Submit lab')).toHaveAccessibleDescription('2 steps still need an answer: step 1 and step 2.');
    await userEvent.click(screen.getByRole('radio', { name: 'Physical' }));
    expect(button('Submit lab')).toBeDisabled();
    expect(screen.getByText('1 step still needs an answer: step 2.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Log review' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Camera' }));
    expect(screen.getByText('Every step has an answer.')).toBeInTheDocument();
    expect(button('Submit lab')).toBeEnabled();

    await userEvent.click(button('Submit lab'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Results' })).toHaveFocus();
    // The untouched order step is sent as it was served.
    expect(bodies(SUBMIT)).toEqual([ANSWERS]);

    const score = within(screen.getByRole('region', { name: 'Score' }));
    expect(score.getByText('80%')).toBeInTheDocument();
    expect(score.getByText('Passed')).toBeInTheDocument();
    expect(score.getByText('You need 80% or more to pass a lab.')).toBeInTheDocument();
    expect(score.getByText('XP earned: 105')).toBeInTheDocument();
    expect(screen.getByText('Lab passed: Classify the controls')).toBeInTheDocument();

    expect(within(result(1)).getByText('A lock is something you can touch.')).toBeInTheDocument();
    expect(within(result(2)).getByText('Both notice an event.')).toBeInTheDocument();
    expect(within(result(3)).getByText('List first, then classify.')).toBeInTheDocument();
    expect(step(1)).toHaveAccessibleName(/^Step 1 of 3:\s*Correct$/);
    expect(step(3)).toHaveAccessibleName(/^Step 3 of 3:\s*Partly correct \(50%\)$/);
    // The answers that were sent are shown, locked.
    expect(within(step(1)).getByRole('radio', { name: /Physical/ })).toBeChecked();
    expect(within(step(1)).getByRole('radio', { name: /Physical/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Submit lab' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to labs' })).toHaveAttribute('href', '/labs');

    for (const key of ['dashboard', 'path', 'labs']) expect(client.getQueryState([key])?.isInvalidated).toBe(true);
  });

  it('lab: below 80 the result reads "Not passed", the score is not rounded up, and Try again resets the answers', async () => {
    handlers[SUBMIT] = () =>
      json(200, submitted({ scorePct: 79.99, passed: false, xp: 0, steps: { ...submitted().steps, 'lab-1-01-s1': feedback(false, 'A lock is something you can touch.') } }));
    await answerAll();
    await userEvent.click(button('Submit lab'));

    await screen.findByRole('heading', { level: 2, name: 'Results' });
    const score = within(screen.getByRole('region', { name: 'Score' }));
    expect(score.getByText('79%')).toBeInTheDocument();
    expect(score.getByText('Not passed')).toBeInTheDocument();
    expect(score.getByText('XP earned: 0')).toBeInTheDocument();
    expect(screen.queryByText(/Lab passed/)).not.toBeInTheDocument();
    expect(step(1)).toHaveAccessibleName(/^Step 1 of 3:\s*Incorrect$/);

    await userEvent.click(button('Try again'));
    expect(screen.queryByRole('heading', { level: 2, name: 'Results' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Classify the controls' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Physical' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Physical' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Camera' })).not.toBeChecked();
    expect(button('Submit lab')).toBeDisabled();
    for (const region of screen.getAllByRole('status', { name: 'Result' })) expect(region).toBeEmptyDOMElement();
    expect(calls(SUBMIT)).toHaveLength(1);
  });

  it('lab: a double click on Submit lab posts once, and a stray click on Try again does not throw the results away', async () => {
    const answer = deferred<Response>();
    handlers[SUBMIT] = () => answer.promise;
    await answerAll();
    await userEvent.dblClick(button('Submit lab'));
    await userEvent.click(button(/Submit/));
    expect(calls(SUBMIT)).toHaveLength(1);
    // The answers cannot be changed under a submission that is on its way.
    expect(screen.getByRole('radio', { name: 'Physical' })).toBeDisabled();

    answer.resolve(json(200, submitted()));
    await screen.findByRole('heading', { level: 2, name: 'Results' });
    fireEvent.click(button('Try again'), { detail: 2 });
    expect(screen.getByRole('heading', { level: 2, name: 'Results' })).toBeInTheDocument();
    expect(calls(SUBMIT)).toHaveLength(1);
  });

  it('lab: keeps the answers and offers a retry when the submission cannot be sent', async () => {
    let online = false;
    handlers[SUBMIT] = () => (online ? json(200, submitted()) : Promise.reject(new TypeError('offline')));
    await answerAll();
    await userEvent.click(button('Submit lab'));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't submit the lab. Your answers are still here.");
    expect(screen.getByRole('radio', { name: 'Physical' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Camera' })).toBeChecked();
    expect(screen.queryByRole('heading', { level: 2, name: 'Results' })).not.toBeInTheDocument();

    online = true;
    await userEvent.click(button('Try again'));
    await screen.findByRole('heading', { level: 2, name: 'Results' });
    expect(bodies(SUBMIT)).toEqual([ANSWERS, ANSWERS]);
  });

  it('lab: a lab that has gone away while it was open leads back to the list instead of a retry', async () => {
    handlers[SUBMIT] = () => json(404, { error: 'Lab not found' });
    await answerAll();
    await userEvent.click(button('Submit lab'));
    expect(await screen.findByRole('alert')).toHaveTextContent('This lab is no longer available.');
    expect(screen.queryByRole('button', { name: /Submit lab|Try again/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole('alert')).getByRole('link', { name: 'Back to labs' })).toHaveAttribute('href', '/labs');
  });

  it('lab: a locked or unknown lab says so and links back to the list', async () => {
    handlers[LAB] = () => json(403, { error: 'Finish the lessons for this lab and unlock its domain first' });
    const view = renderAt('/labs/lab-1-01');
    expect(await screen.findByRole('alert')).toHaveTextContent('Finish the lessons for this lab and unlock its domain first');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to labs' })).toHaveAttribute('href', '/labs');
    view.unmount();

    handlers['GET /api/labs/nope'] = () => json(404, { error: 'Lab not found' });
    renderAt('/labs/nope');
    expect(await screen.findByRole('alert')).toHaveTextContent("This lab isn't available.");
    expect(screen.getByRole('link', { name: 'Back to labs' })).toBeInTheDocument();
  });

  it('lab: the scenario can be folded away and brought back', async () => {
    renderAt('/labs/lab-1-01');
    await screen.findByRole('heading', { level: 1, name: 'Classify the controls' });
    const toggle = button('Hide scenario');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Folding only applies where the scenario sits across the top (narrow screens): the class hides it there.
    expect(screen.getByText(lab.scenario).parentElement).not.toHaveClass('hidden');
    await userEvent.click(toggle);
    expect(button('Show scenario')).toHaveAttribute('aria-expanded', 'false');
    expect(button('Show scenario')).toHaveFocus();
    expect(screen.getByText(lab.scenario).parentElement).toHaveClass('hidden', 'lg:block');
    await userEvent.click(button('Show scenario'));
    expect(screen.getByText(lab.scenario).parentElement).not.toHaveClass('hidden');
  });
});
