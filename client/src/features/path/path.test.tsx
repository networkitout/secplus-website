import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PathDomain, PathObjective, PathResponse } from '../../api/types';
import { createQueryClient } from '../../queryClient';
import { holdPressClock } from '../../test/pressClock';
import { SETTLE_MS } from '../../ui/pressGuard';
import { PathPage } from './PathPage';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const objective = (id: string, over: Partial<PathObjective> = {}): PathObjective => ({
  id, title: `Objective ${id} title`, published: true, lessonDone: false, quizPassed: false, mastery: 0, ...over,
});

const domain = (id: number, title: string, over: Partial<PathDomain> = {}): PathDomain => ({
  id, title, weight: 20, unlocked: false, examPassed: false, hasContent: false, openExam: null,
  objectives: [objective(`${id}.1`, { published: false }), objective(`${id}.2`, { published: false })],
  ...over,
});

const path = (): PathResponse => ({
  domains: [
    domain(1, 'General Security Concepts', {
      weight: 12, unlocked: true, hasContent: true,
      objectives: [
        objective('1.1', { lessonDone: true, quizPassed: true, mastery: 80 }),
        objective('1.2'),
        objective('1.3', { published: false }),
      ],
    }),
    domain(2, 'Threats, Vulnerabilities, and Mitigations', {
      hasContent: true, objectives: [objective('2.1'), objective('2.2')],
    }),
    domain(3, 'Security Architecture'),
    domain(4, 'Security Operations'),
    domain(5, 'Security Program Management and Oversight'),
  ],
});

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handlers: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  handlers = { 'GET /api/path': () => json(200, path()) };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const h = handlers[key];
    if (!h) throw new Error(`unexpected request ${key}`);
    return h(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function Stub({ name }: { name: string }) {
  const { id, objective: o } = useParams();
  return <p>{`${name} ${id ?? o}`}</p>;
}

function renderPath() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<PathPage />} />
          <Route path="/lesson/:objective" element={<Stub name="lesson screen" />} />
          <Route path="/exam/:id" element={<Stub name="exam screen" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const domainCard = (n: number) => screen.findByRole('region', { name: new RegExp(`^Domain ${n}:`) });
const node = (card: HTMLElement, id: string) => within(card).getByText(`Objective ${id} title`).closest('li')!;
/** Presses "Domain exam" and confirms in the dialog that asks first. */
async function confirmStart(button: HTMLElement) {
  await userEvent.click(button);
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start exam' }));
}
const calls = (key: string) => fetchMock.mock.calls.filter(([u, i]) => `${i?.method ?? 'GET'} ${u}` === key);

describe('path', () => {
  it('path: locked domain nodes are not links and state how to unlock; hasContent false shows "Coming soon"', async () => {
    renderPath();

    const locked = await domainCard(2);
    expect(within(locked).getByText('Pass the Domain 1 exam to unlock')).toBeInTheDocument();
    for (const id of ['2.1', '2.2']) expect(within(node(locked, id)).getByText('Locked')).toBeInTheDocument();
    expect(within(locked).queryAllByRole('link')).toHaveLength(0);
    expect(within(locked).queryByRole('button')).not.toBeInTheDocument();
    expect(within(locked).queryByText('Coming soon')).not.toBeInTheDocument();

    const empty = await domainCard(3);
    // Once for the domain, once for each of its two objectives.
    expect(within(empty).getAllByText('Coming soon')).toHaveLength(3);
    expect(within(empty).getByText('Pass the Domain 2 exam to unlock')).toBeInTheDocument();
    for (const id of ['3.1', '3.2']) expect(within(node(empty, id)).getByText('Coming soon')).toBeInTheDocument();
    expect(within(empty).queryAllByRole('link')).toHaveLength(0);
    expect(within(empty).queryByRole('button')).not.toBeInTheDocument();
  });

  it('path: completed objective shows both checkmarks with accessible labels', async () => {
    renderPath();
    const open = await domainCard(1);

    const done = node(open, '1.1');
    for (const label of ['Lesson done', 'Quiz passed']) {
      const mark = within(done).getByText(label);
      // The tick is decoration; the words carry the state.
      expect(mark.parentElement).toHaveTextContent(`✓${label}`);
      expect(within(mark.parentElement!).getByText('✓')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(within(done).getByRole('progressbar', { name: 'Mastery of objective 1.1' })).toHaveAttribute('aria-valuenow', '80');

    const fresh = node(open, '1.2');
    expect(within(fresh).getByText('Lesson not done')).toBeInTheDocument();
    expect(within(fresh).getByText('Quiz not passed')).toBeInTheDocument();
    expect(within(fresh).queryByText('✓')).not.toBeInTheDocument();
    expect(within(fresh).getByRole('progressbar', { name: 'Mastery of objective 1.2' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('shows the five domains in order, each with its exam weight', async () => {
    renderPath();
    await domainCard(1);
    const cards = screen.getAllByRole('region');
    expect(cards.map((c) => within(c).getByRole('heading', { level: 2 }).textContent)).toEqual([
      'Domain 1: General Security Concepts',
      'Domain 2: Threats, Vulnerabilities, and Mitigations',
      'Domain 3: Security Architecture',
      'Domain 4: Security Operations',
      'Domain 5: Security Program Management and Oversight',
    ]);
    expect(within(cards[0]!).getByText('12% of the exam')).toBeInTheDocument();
  });

  it('links published objectives of an open domain to their lesson; an unpublished one is "Coming soon" and not a link', async () => {
    renderPath();
    const open = await domainCard(1);
    expect(within(open).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/lesson/1.1', '/lesson/1.2']);

    const unpublished = node(open, '1.3');
    expect(within(unpublished).getByText('Coming soon')).toBeInTheDocument();
    expect(within(unpublished).queryByRole('link')).not.toBeInTheDocument();
    expect(within(unpublished).queryByRole('progressbar')).not.toBeInTheDocument();

    await userEvent.click(within(open).getByRole('link', { name: '1.2 Objective 1.2 title' }));
    expect(screen.getByText('lesson screen 1.2')).toBeInTheDocument();
  });

  it('renders titles from the API as text', async () => {
    const data = path();
    data.domains[0]!.title = '<img src=x onerror=alert(1)>';
    data.domains[0]!.objectives[0]!.title = '<b>bold</b>';
    handlers['GET /api/path'] = () => json(200, data);
    renderPath();
    const open = await domainCard(1);
    expect(within(open).getByRole('heading', { level: 2 })).toHaveTextContent('Domain 1: <img src=x onerror=alert(1)>');
    expect(within(open).getByText('<b>bold</b>')).toBeInTheDocument();
    expect(open.querySelector('img, b')).toBeNull();
  });

  it('"Domain exam" asks first and states the rules; Cancel creates nothing; "Start exam" creates the exam and opens it', async () => {
    handlers['POST /api/assessments'] = () => json(201, { id: 7 });
    renderPath();
    const open = await domainCard(1);
    const button = within(open).getByRole('button', { name: 'Domain exam, Domain 1' });
    await userEvent.click(button);

    const dialog = screen.getByRole('dialog', { name: 'Start the Domain 1 exam?' });
    // The rules as the server applies them.
    expect(dialog).toHaveAccessibleDescription(/Up to 25 questions/);
    expect(dialog).toHaveAccessibleDescription(/25 minutes/);
    expect(dialog).toHaveAccessibleDescription(/75% to pass/);
    expect(dialog).toHaveAccessibleDescription(/no feedback until the end/i);
    expect(dialog).toHaveAccessibleDescription(/clock starts/);
    expect(calls('POST /api/assessments')).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(calls('POST /api/assessments')).toHaveLength(0);

    await userEvent.click(button);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start exam' }));
    expect(await screen.findByText('exam screen 7')).toBeInTheDocument();
    const [, init] = calls('POST /api/assessments')[0]!;
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'domain', scope: '1' });
    // The path now has an exam in progress: it is read again for the next visit.
    await waitFor(() => expect(calls('GET /api/path')).toHaveLength(2));
  });

  it('a second press that lands on the dialog straight after "Domain exam" neither starts the exam nor closes the dialog', async () => {
    const clock = holdPressClock();
    handlers['POST /api/assessments'] = () => json(201, { id: 7 });
    renderPath();
    const open = await domainCard(1);
    await userEvent.click(within(open).getByRole('button', { name: 'Domain exam, Domain 1' }));

    const dialog = screen.getByRole('dialog', { name: 'Start the Domain 1 exam?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start exam' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    clock.advance(SETTLE_MS - 1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start exam' }));
    expect(calls('POST /api/assessments')).toHaveLength(0);
    expect(dialog).toBeInTheDocument();

    clock.advance(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start exam' }));
    expect(await screen.findByText('exam screen 7')).toBeInTheDocument();
    expect(calls('POST /api/assessments')).toHaveLength(1);
  });

  it('offers "Resume domain exam" for an exam in progress and opens it without asking or creating anything', async () => {
    const data = path();
    data.domains[0]!.openExam = { id: 44, deadlineAt: '2026-11-10T12:25:00.000Z' };
    handlers['GET /api/path'] = () => json(200, data);
    renderPath();
    const open = await domainCard(1);
    expect(within(open).queryByRole('button', { name: /^Domain exam/ })).not.toBeInTheDocument();
    expect(within(open).getByText('You have an exam in progress. Its clock is running.')).toBeInTheDocument();

    await userEvent.click(within(open).getByRole('button', { name: 'Resume domain exam, Domain 1' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('exam screen 44')).toBeInTheDocument();
    expect(calls('POST /api/assessments')).toHaveLength(0);
  });

  it('keeps the learner on the path with a message when the exam cannot be started', async () => {
    handlers['POST /api/assessments'] = () => json(503, { error: 'Service unavailable' });
    renderPath();
    const open = await domainCard(1);
    const start = within(open).getByRole('button', { name: /^Domain exam/ });
    await confirmStart(start);

    expect(await within(open).findByRole('alert')).toHaveTextContent("Can't reach the server. Try again in a moment.");
    expect(start).toBeEnabled();
    expect(start).toHaveFocus();

    handlers['POST /api/assessments'] = () => json(200, { id: 9 });
    await confirmStart(start);
    expect(await screen.findByText('exam screen 9')).toBeInTheDocument();
  });

  it('offers no exam for an open domain without content, and says when an exam was passed', async () => {
    const data = path();
    data.domains[0]!.examPassed = true;
    data.domains[1] = { ...data.domains[1]!, unlocked: true, hasContent: false, objectives: [objective('2.1', { published: false })] };
    handlers['GET /api/path'] = () => json(200, data);
    renderPath();

    expect(within(await domainCard(1)).getByText('Domain exam passed')).toBeInTheDocument();
    const empty = await domainCard(2);
    expect(within(empty).getAllByText('Coming soon').length).toBeGreaterThan(0);
    expect(within(empty).queryByText('Locked')).not.toBeInTheDocument();
    expect(within(empty).queryByRole('button')).not.toBeInTheDocument();
    expect(within(empty).queryAllByRole('link')).toHaveLength(0);
  });

  it('says so when the path cannot be loaded', async () => {
    handlers['GET /api/path'] = () => json(500, { error: 'Internal error' });
    renderPath();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your study path.");
    expect(screen.getByRole('heading', { level: 1, name: 'Study path' })).toBeInTheDocument();
  });

  it('two presses on "Domain exam" while it is being created post once, and say that it is starting', async () => {
    let release!: () => void;
    handlers['POST /api/assessments'] = () => new Promise<Response>((resolve) => (release = () => resolve(json(201, { id: 7 }))));
    renderPath();
    const open = await domainCard(1);
    const start = within(open).getByRole('button', { name: /^Domain exam/ });

    await userEvent.click(start);
    await userEvent.dblClick(screen.getByRole('button', { name: 'Start exam' }));
    expect(calls('POST /api/assessments')).toHaveLength(1);
    // While the exam is being created the button neither asks again nor starts another.
    await userEvent.click(start);
    start.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls('POST /api/assessments')).toHaveLength(1);
    expect(start).toHaveAttribute('aria-busy', 'true');
    expect(start).toBeEnabled();
    expect(within(open).getByText('Starting the exam…')).toHaveAttribute('role', 'status');

    release();
    expect(await screen.findByText('exam screen 7')).toBeInTheDocument();
    expect(calls('POST /api/assessments')).toHaveLength(1);
  });

  it('does not open the exam when the learner has gone elsewhere before it was created', async () => {
    let release!: () => void;
    handlers['POST /api/assessments'] = () => new Promise<Response>((resolve) => (release = () => resolve(json(201, { id: 7 }))));
    renderPath();
    const open = await domainCard(1);
    await confirmStart(within(open).getByRole('button', { name: /^Domain exam/ }));
    await userEvent.click(within(open).getByRole('link', { name: '1.2 Objective 1.2 title' }));
    expect(await screen.findByText('lesson screen 1.2')).toBeInTheDocument();

    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('lesson screen 1.2')).toBeInTheDocument();
    expect(screen.queryByText(/exam screen/)).not.toBeInTheDocument();
  });

  it('says that it is loading while "Try again" fetches the path once more', async () => {
    handlers['GET /api/path'] = () => json(500, { error: 'Internal error' });
    renderPath();
    await screen.findByRole('alert');

    let release!: () => void;
    handlers['GET /api/path'] = () => new Promise<Response>((resolve) => (release = () => resolve(json(200, path()))));
    const again = screen.getByRole('button', { name: 'Try again' });
    await userEvent.click(again);
    expect(again).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading your study path…')).toHaveAttribute('role', 'status');

    release();
    expect(await domainCard(1)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
