import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Feedback, LessonProgressView, LessonView, PublicQuestion } from '../../../../shared/types';
import type { LessonResponse } from '../../api/types';
import { createQueryClient } from '../../queryClient';
import { holdPressClock } from '../../test/pressClock';
import { SETTLE_MS } from '../../ui/pressGuard';
import { PathPage } from '../path/PathPage';
import { RewardsContext, type RewardsValue } from '../rewards/RewardsProvider';
import { InlineCheck } from './InlineCheck';
import { LessonPage } from './LessonPage';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

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
  id: 'q-1.1-003', objective: '1.1', difficulty: 2, type: 'order',
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

const lesson = (): LessonView => ({
  objective: '1.1',
  title: 'Security controls',
  minutes: 12,
  sections: [
    {
      id: 's1', title: 'Control categories',
      blocks: [
        { kind: 'html', html: '<p>Controls come in <strong>four</strong> categories.</p>' },
        { kind: 'check', question: single },
      ],
    },
    {
      id: 's2', title: 'The CIA triad',
      blocks: [
        { kind: 'html', html: '<p>Three goals.</p>' },
        { kind: 'diagram', name: 'cia-triad' },
      ],
    },
    { id: 's3', title: 'Summary', blocks: [{ kind: 'html', html: '<p>That is the lesson.</p>' }] },
  ],
});

const response = (sectionsDone: string[] = [], over: Partial<LessonView> = {}): LessonResponse => ({
  lesson: { ...lesson(), ...over },
  progress: { sectionsDone, completedAt: sectionsDone.length === 3 ? '2026-11-10T10:00:00.000Z' : null },
});

const saved = (sectionsDone: string[], xp = 0): LessonProgressView & { xp: number; newBadges: string[] } => ({
  sectionsDone, completedAt: sectionsDone.length === 3 ? '2026-11-10T10:00:00.000Z' : null, xp, newBadges: [],
});

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handlers: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;
/** Stands in for the rewards provider: what the lesson reports to it. */
let report: Mock<RewardsValue['report']>;

beforeEach(() => {
  handlers = { 'GET /api/lessons/1.1': () => json(200, response()) };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const h = handlers[key];
    if (!h) throw new Error(`unexpected request ${key}`);
    return h(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  report = vi.fn<RewardsValue['report']>();

  // The player ignores presses for a moment after the screen changes (so that the second click of a
  // double click cannot act on the next screen). Here that moment only passes when a test says so, with
  // `read()`: a press without it comes straight after the change.
  clock = holdPressClock();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let clock: ReturnType<typeof holdPressClock>;
/** The learner takes the time to read what is on screen. */
const read = () => clock.advance(5000);

/** A response that the test releases when it chooses. */
function deferred(status: number, body: unknown) {
  let release!: () => void;
  const response = new Promise<Response>((resolve) => {
    release = () => resolve(json(status, body));
  });
  return { response, release };
}

function Stub({ name }: { name: string }) {
  const { id } = useParams();
  return <p>{`${name} ${id ?? ''}`}</p>;
}

function renderLesson(client: QueryClient = createQueryClient(), start = '/lesson/1.1') {
  return render(
    <QueryClientProvider client={client}>
      <RewardsContext.Provider value={{ report }}>
        <MemoryRouter initialEntries={[start]}>
          <Link to="/elsewhere">Elsewhere</Link>
          <Link to="/lesson/1.2">Other lesson</Link>
          <Routes>
            <Route path="/" element={<Stub name="path screen" />} />
            <Route path="/elsewhere" element={<Stub name="another screen" />} />
            <Route path="/lesson/:objective" element={<LessonPage />} />
            <Route path="/quiz/:id" element={<Stub name="quiz screen" />} />
          </Routes>
        </MemoryRouter>
      </RewardsContext.Provider>
    </QueryClientProvider>,
  );
}

const requests = (key: string) => fetchMock.mock.calls.filter(([u, i]) => `${i?.method ?? 'GET'} ${u}` === key);
const bodies = (key: string) => requests(key).map(([, i]) => JSON.parse(String(i.body)));
/** Finds the heading of the section on screen, then lets the learner "read" it (see `read`). */
const sectionHeading = async (name: string) => {
  const heading = await screen.findByRole('heading', { level: 2, name });
  read();
  return heading;
};
// A diagram inside the section has a Next button of its own; the lesson's is in the "Lesson sections" group.
const next = () => within(screen.getByRole('group', { name: 'Lesson sections' })).getByRole('button', { name: 'Next' });
const progress = () => screen.getByRole('progressbar', { name: 'Lesson progress' });

async function answerCheck(choice: string) {
  await userEvent.click(screen.getByRole('radio', { name: choice }));
  await userEvent.click(screen.getByRole('button', { name: 'Check answer' }));
}

describe('lesson', () => {
  it('lesson: Next disabled until the inline check is answered, then enabled; posts progress on Next', async () => {
    handlers['POST /api/answers'] = () => json(200, { feedback: right, xp: 10, newBadges: [] });
    handlers['POST /api/lessons/1.1/progress'] = () => json(200, saved(['s1']));
    renderLesson();

    await sectionHeading('Control categories');
    expect(screen.getByRole('heading', { level: 1, name: 'Security controls' })).toBeInTheDocument();
    expect(screen.getByText('Section 1 of 3')).toBeInTheDocument();
    expect(progress()).toHaveAttribute('aria-valuenow', '0');
    expect(progress()).toHaveAttribute('aria-valuemax', '3');
    expect(next()).toBeDisabled();
    expect(next()).toHaveAccessibleDescription('Answer the question above to continue.');
    expect(screen.getByRole('button', { name: 'Check answer' })).toBeDisabled();
    expect(screen.getByRole('status', { name: 'Result' })).toBeEmptyDOMElement();

    await answerCheck('Technical');

    expect(await within(screen.getByRole('status', { name: 'Result' })).findByText('A firewall rule is enforced by technology.')).toBeInTheDocument();
    expect(bodies('POST /api/answers')).toEqual([{ questionId: 'q-1.1-001', answer: { type: 'single', choice: 'a' } }]);
    expect(screen.queryByRole('button', { name: 'Check answer' })).not.toBeInTheDocument();
    // The pressed button is gone; focus stays in the check instead of falling back to the page.
    expect(screen.getByRole('region', { name: 'Check your understanding' })).toHaveFocus();
    expect(next()).toBeEnabled();
    expect(next()).not.toHaveAccessibleDescription();
    expect(bodies('POST /api/lessons/1.1/progress')).toEqual([]);

    await userEvent.click(next());

    const second = await sectionHeading('The CIA triad');
    expect(bodies('POST /api/lessons/1.1/progress')).toEqual([{ sectionId: 's1' }]);
    expect(second).toHaveFocus();
    expect(screen.getByText('Section 2 of 3')).toBeInTheDocument();
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(progress()).toHaveAttribute('aria-valuetext', '1 of 3 sections complete');
    expect(screen.queryByRole('heading', { name: 'Control categories' })).not.toBeInTheDocument();
  });

  it('a wrong answer also unlocks Next', async () => {
    handlers['POST /api/answers'] = () => json(200, { feedback: wrong, xp: 0, newBadges: [] });
    renderLesson();
    await sectionHeading('Control categories');
    await answerCheck('Physical');
    expect(await within(screen.getByRole('status', { name: 'Result' })).findByText('Incorrect')).toBeInTheDocument();
    expect(next()).toBeEnabled();
  });

  it('lesson: resumes at the first section not in sectionsDone', async () => {
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1']));
    renderLesson();
    await sectionHeading('The CIA triad');
    expect(screen.getByText('Section 2 of 3')).toBeInTheDocument();
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(screen.queryByRole('heading', { name: 'Control categories' })).not.toBeInTheDocument();
    // A section without checks never blocks.
    expect(next()).toBeEnabled();
  });

  it('lesson: last section shows Celebration and "Take the quiz"', async () => {
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1', 's2']));
    handlers['POST /api/lessons/1.1/progress'] = () => json(200, saved(['s1', 's2', 's3'], 50));
    handlers['POST /api/assessments'] = () => json(201, { id: 12 });
    renderLesson();

    await sectionHeading('Summary');
    expect(within(screen.getByRole('group', { name: 'Lesson sections' })).queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take the quiz' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Finish lesson' }));

    const done = await sectionHeading("You've finished this lesson");
    expect(done).toHaveFocus();
    expect(bodies('POST /api/lessons/1.1/progress')).toEqual([{ sectionId: 's3' }]);
    const celebration = screen.getByRole('group', { name: 'Lesson complete' });
    expect(celebration).toHaveTextContent('Lesson completeSecurity controls+50 XP');
    // It is announced with the heading that takes focus, not by a live region that arrives with its text.
    expect(done).toHaveAccessibleDescription(/Lesson complete\s*Security controls\s*\+50 XP/);
    expect(celebration.closest('[role="status"]')).toBeNull();
    expect(celebration).not.toHaveTextContent('Streak');
    expect(within(celebration).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(progress()).toHaveAttribute('aria-valuenow', '3');

    await userEvent.click(screen.getByRole('button', { name: 'Take the quiz' }));
    expect(await screen.findByText('quiz screen 12')).toBeInTheDocument();
    expect(bodies('POST /api/assessments')).toEqual([{ kind: 'objective', scope: '1.1' }]);
  });

  it('dismissing the celebration leaves focus on the page, not on a removed button', async () => {
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1', 's2']));
    handlers['POST /api/lessons/1.1/progress'] = () => json(200, saved(['s1', 's2', 's3'], 50));
    renderLesson();
    await sectionHeading('Summary');
    await userEvent.click(screen.getByRole('button', { name: 'Finish lesson' }));
    const done = await sectionHeading("You've finished this lesson");
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Lesson complete')).not.toBeInTheDocument();
    expect(done).toHaveFocus();
  });

  it('lesson: unknown diagram name renders a visible "Diagram unavailable" note, not a crash', async () => {
    const sections = lesson().sections;
    sections[1]!.blocks.push(
      { kind: 'diagram', name: 'not-a-diagram' } as never,
      // A name that exists on every object must not be mistaken for a diagram either.
      { kind: 'diagram', name: 'constructor' } as never,
      { kind: 'html', html: '<p>Text after the diagrams.</p>' },
    );
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1'], { sections }));
    renderLesson();

    await sectionHeading('The CIA triad');
    expect(screen.getAllByText('Diagram unavailable')).toHaveLength(2);
    expect(screen.getByText('Text after the diagrams.')).toBeInTheDocument();
    // The known diagram in the same section still renders.
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('renders the lesson and section titles as text and only the section html as HTML', async () => {
    const sections = lesson().sections;
    sections[0] = { id: 's1', title: '<img src=x onerror=alert(1)>', blocks: [{ kind: 'html', html: '<p>Uses <strong>bold</strong> text.</p>' }] };
    handlers['GET /api/lessons/1.1'] = () => json(200, response([], { title: '<script>alert(1)</script>', sections }));
    renderLesson();

    expect(await sectionHeading('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('<script>alert(1)</script>');
    expect(document.querySelector('img, script')).toBeNull();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('keeps the learner on the section with a retry when progress cannot be saved', async () => {
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1']));
    handlers['POST /api/lessons/1.1/progress'] = () => json(503, { error: 'Service unavailable' });
    renderLesson();
    const heading = await sectionHeading('The CIA triad');
    await userEvent.click(next());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't save your progress. You are still on this section.");
    expect(heading).toBeInTheDocument();
    expect(screen.getByText('Section 2 of 3')).toBeInTheDocument();
    expect(progress()).toHaveAttribute('aria-valuenow', '1');

    handlers['POST /api/lessons/1.1/progress'] = () => json(200, saved(['s1', 's2']));
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await sectionHeading('Summary');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(bodies('POST /api/lessons/1.1/progress')).toEqual([{ sectionId: 's2' }, { sectionId: 's2' }]);
  });

  it('keeps the chosen answer and offers a retry when an answer cannot be sent', async () => {
    handlers['POST /api/answers'] = () => {
      throw new TypeError('Failed to fetch');
    };
    renderLesson();
    await sectionHeading('Control categories');
    await answerCheck('Technical');

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send your answer. It has not been marked yet.");
    expect(screen.getByRole('radio', { name: 'Technical' })).toBeChecked();
    expect(next()).toBeDisabled();

    handlers['POST /api/answers'] = () => json(200, { feedback: right, xp: 10, newBadges: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await within(screen.getByRole('status', { name: 'Result' })).findByText('Correct')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(next()).toBeEnabled();
  });

  it('submits the served order when an order check is left untouched', async () => {
    const sections = lesson().sections;
    sections[0]!.blocks = [{ kind: 'check', question: order }];
    handlers['GET /api/lessons/1.1'] = () => json(200, response([], { sections }));
    handlers['POST /api/answers'] = () =>
      json(200, { feedback: { correct: false, fraction: 0, correctAnswer: { type: 'order', order: ['a', 'b', 'c'] }, explanation: 'Request comes first.' }, xp: 0, newBadges: [] });
    renderLesson();
    await sectionHeading('Control categories');
    await userEvent.click(screen.getByRole('button', { name: 'Check answer' }));

    expect(await within(screen.getByRole('status', { name: 'Result' })).findByText('Request comes first.')).toBeInTheDocument();
    expect(bodies('POST /api/answers')).toEqual([{ questionId: 'q-1.1-003', answer: { type: 'order', order: ['c', 'a', 'b'] } }]);
  });

  it('needs every check of a section answered, and remembers answers when the learner goes back', async () => {
    const second: PublicQuestion = { ...single, id: 'q-1.1-002', prompt: 'Which category is a door lock?' };
    const sections = lesson().sections;
    sections[1]!.blocks = [{ kind: 'check', question: single }, { kind: 'check', question: second }];
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1'], { sections }));
    handlers['POST /api/answers'] = () => json(200, { feedback: right, xp: 0, newBadges: [] });
    handlers['POST /api/lessons/1.1/progress'] = () => json(200, saved(['s1', 's2']));
    renderLesson();
    await sectionHeading('The CIA triad');

    const [first, other] = screen.getAllByRole('button', { name: 'Check answer' });
    await userEvent.click(screen.getAllByRole('radio', { name: 'Technical' })[0]!);
    await userEvent.click(first!);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Check answer' })).toHaveLength(1));
    expect(next()).toBeDisabled();

    await userEvent.click(screen.getAllByRole('radio', { name: 'Physical' })[1]!);
    await userEvent.click(other!);
    await waitFor(() => expect(next()).toBeEnabled());

    await userEvent.click(next());
    await sectionHeading('Summary');
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await sectionHeading('The CIA triad')).toHaveFocus();
    // Both checks still show their result, and nothing is sent again.
    expect(screen.queryByRole('button', { name: 'Check answer' })).not.toBeInTheDocument();
    expect(screen.getAllByText('A firewall rule is enforced by technology.')).toHaveLength(2);
    await userEvent.click(next());
    await sectionHeading('Summary');
    expect(bodies('POST /api/lessons/1.1/progress')).toEqual([{ sectionId: 's2' }]);
  });

  it('does not ask again for the checks of a section that is already done', async () => {
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1']));
    renderLesson();
    await sectionHeading('The CIA triad');
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));

    await sectionHeading('Control categories');
    // After a reload the server does not say which checks were answered: the check can be taken again,
    // but the finished section does not hold the learner back.
    expect(screen.getByRole('button', { name: 'Check answer' })).toBeInTheDocument();
    expect(next()).toBeEnabled();
    await userEvent.click(next());
    await sectionHeading('The CIA triad');
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  });

  it('opens a completed lesson on its end screen, without a celebration, and can be read again', async () => {
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1', 's2', 's3']));
    renderLesson();

    await sectionHeading("You've finished this lesson");
    expect(screen.getByRole('button', { name: 'Take the quiz' })).toBeInTheDocument();
    expect(screen.queryByText('Lesson complete')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the study path' })).toHaveAttribute('href', '/');

    await userEvent.click(screen.getByRole('button', { name: 'Read the lesson again' }));
    expect(await sectionHeading('Control categories')).toHaveFocus();
    expect(next()).toBeEnabled();
  });

  it('says so when the quiz cannot be started', async () => {
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1', 's2', 's3']));
    handlers['POST /api/assessments'] = () => json(503, { error: 'Service unavailable' });
    renderLesson();
    await sectionHeading("You've finished this lesson");
    await userEvent.click(screen.getByRole('button', { name: 'Take the quiz' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server. Try again in a moment.");
    expect(screen.getByRole('button', { name: 'Take the quiz' })).toBeEnabled();
  });

  it.each([
    [404, 'Objective not found', "This lesson isn't available."],
    [403, 'Pass the previous domain exam to unlock this domain', 'Pass the previous domain exam to unlock this domain'],
  ])('shows a message and a way back for a %i', async (status, error, text) => {
    handlers['GET /api/lessons/1.1'] = () => json(status, { error });
    renderLesson();
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    await userEvent.click(screen.getByRole('link', { name: 'Back to the study path' }));
    expect(screen.getByText(/path screen/)).toBeInTheDocument();
  });
});

describe('lesson: pressing a control twice', () => {
  it('a double click on Next with an immediate response lands on the next section and posts once', async () => {
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1']));
    handlers['POST /api/lessons/1.1/progress'] = (_url, init) =>
      json(200, saved(JSON.parse(String(init!.body)).sectionId === 's2' ? ['s1', 's2'] : ['s1', 's2', 's3'], 50));
    renderLesson();
    await sectionHeading('The CIA triad');

    await userEvent.dblClick(next());

    // The second click arrives when the last section is already showing; it must not finish the lesson.
    expect(await screen.findByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument();
    expect(bodies('POST /api/lessons/1.1/progress')).toEqual([{ sectionId: 's2' }]);
  });

  it('a double click on Next in a section that is already done moves one section, not two', async () => {
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1', 's2', 's3']));
    renderLesson();
    await sectionHeading("You've finished this lesson");
    await userEvent.click(screen.getByRole('button', { name: 'Read the lesson again' }));
    await sectionHeading('Control categories');

    await userEvent.dblClick(next());
    expect(await screen.findByRole('heading', { level: 2, name: 'The CIA triad' })).toBeInTheDocument();
    expect(screen.getByText('Section 2 of 3')).toBeInTheDocument();

    // Once the learner has had time to see the section, Next works again: not a moment before.
    clock.advance(SETTLE_MS - 1);
    await userEvent.click(next());
    expect(screen.getByRole('heading', { level: 2, name: 'The CIA triad' })).toBeInTheDocument();
    clock.advance(1);
    await userEvent.click(next());
    expect(await screen.findByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument();
  });

  it('a press that lands on the end screen straight after "Finish lesson" does not start the quiz', async () => {
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1', 's2']));
    handlers['POST /api/lessons/1.1/progress'] = () => json(200, saved(['s1', 's2', 's3'], 50));
    handlers['POST /api/assessments'] = () => json(201, { id: 12 });
    renderLesson();
    await sectionHeading('Summary');
    await userEvent.click(screen.getByRole('button', { name: 'Finish lesson' }));
    await screen.findByRole('heading', { level: 2, name: "You've finished this lesson" });

    await userEvent.click(screen.getByRole('button', { name: 'Take the quiz' }));
    await userEvent.click(screen.getByRole('button', { name: 'Read the lesson again' }));
    expect(requests('POST /api/assessments')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 2, name: "You've finished this lesson" })).toBeInTheDocument();

    clock.advance(SETTLE_MS - 1);
    await userEvent.click(screen.getByRole('button', { name: 'Take the quiz' }));
    expect(requests('POST /api/assessments')).toHaveLength(0);
    clock.advance(1);
    await userEvent.click(screen.getByRole('button', { name: 'Take the quiz' }));
    expect(await screen.findByText('quiz screen 12')).toBeInTheDocument();
  });

  it('a press that lands on a check straight after its section appeared does not mark it unseen', async () => {
    const sections = lesson().sections;
    // An order question is complete as it is served, so its "Check answer" is live from the start.
    sections[1]!.blocks = [{ kind: 'check', question: order }];
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1'], { sections }));
    handlers['POST /api/answers'] = () =>
      json(200, { feedback: { correct: false, fraction: 0, correctAnswer: { type: 'order', order: ['a', 'b', 'c'] }, explanation: 'Request comes first.' }, xp: 0, newBadges: [] });
    renderLesson();
    // The lesson opens on the section with the check: a press that arrives with it is ignored.
    await screen.findByRole('heading', { level: 2, name: 'The CIA triad' });
    const check = screen.getByRole('button', { name: 'Check answer' });
    expect(check).toBeEnabled();
    await userEvent.click(check);
    clock.advance(SETTLE_MS - 1);
    await userEvent.click(check);
    expect(requests('POST /api/answers')).toHaveLength(0);
    expect(check).toBeEnabled();

    // The same when the section is reached from another one: the press was meant for that one's button.
    clock.advance(1);
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await sectionHeading('Control categories');
    await userEvent.click(next());
    await screen.findByRole('heading', { level: 2, name: 'The CIA triad' });
    await userEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(requests('POST /api/answers')).toHaveLength(0);

    clock.advance(SETTLE_MS);
    await userEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(await within(screen.getByRole('status', { name: 'Result' })).findByText('Request comes first.')).toBeInTheDocument();
    expect(requests('POST /api/answers')).toHaveLength(1);
  });

  it('two presses on Next while the save is still on its way post once, and say that it is saving', async () => {
    const save = deferred(200, saved(['s1', 's2']));
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1']));
    handlers['POST /api/lessons/1.1/progress'] = () => save.response;
    renderLesson();
    await sectionHeading('The CIA triad');
    const button = next();

    await userEvent.click(button);
    await userEvent.click(button);
    button.focus();
    await userEvent.keyboard('{Enter}{Enter}');
    expect(requests('POST /api/lessons/1.1/progress')).toHaveLength(1);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeEnabled();
    expect(screen.getByText('Saving your progress…')).toHaveAttribute('role', 'status');

    save.release();
    expect(await screen.findByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument();
    expect(requests('POST /api/lessons/1.1/progress')).toHaveLength(1);
    expect(screen.queryByText('Saving your progress…')).not.toBeInTheDocument();
  });

  it('Previous is ignored while a save is on its way, so the learner ends up where Next was pressed from', async () => {
    const save = deferred(200, saved(['s1', 's2']));
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1']));
    handlers['POST /api/lessons/1.1/progress'] = () => save.response;
    renderLesson();
    await sectionHeading('The CIA triad');

    await userEvent.click(next());
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('heading', { level: 2, name: 'The CIA triad' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Control categories' })).not.toBeInTheDocument();

    save.release();
    expect(await screen.findByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByText('Section 3 of 3')).toBeInTheDocument();
  });

  it('two presses on "Check answer" while the answer is on its way post once', async () => {
    const marked = deferred(200, { feedback: right, xp: 10, newBadges: [] });
    handlers['POST /api/answers'] = () => marked.response;
    renderLesson();
    await sectionHeading('Control categories');
    await userEvent.click(screen.getByRole('radio', { name: 'Technical' }));
    const button = screen.getByRole('button', { name: 'Check answer' });

    await userEvent.dblClick(button);
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(requests('POST /api/answers')).toHaveLength(1);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Checking your answer…')).toHaveAttribute('role', 'status');

    marked.release();
    expect(await within(screen.getByRole('status', { name: 'Result' })).findByText('Correct')).toBeInTheDocument();
    expect(requests('POST /api/answers')).toHaveLength(1);
  });

  it('two presses on "Take the quiz" while it is being created post once', async () => {
    const created = deferred(201, { id: 12 });
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1', 's2', 's3']));
    handlers['POST /api/assessments'] = () => created.response;
    renderLesson();
    await sectionHeading("You've finished this lesson");
    const button = screen.getByRole('button', { name: 'Take the quiz' });

    await userEvent.dblClick(button);
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(requests('POST /api/assessments')).toHaveLength(1);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Starting the quiz…')).toHaveAttribute('role', 'status');

    created.release();
    expect(await screen.findByText('quiz screen 12')).toBeInTheDocument();
    expect(requests('POST /api/assessments')).toHaveLength(1);
  });

  it('does not open the quiz when the learner has gone elsewhere before it was created', async () => {
    const created = deferred(201, { id: 12 });
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1', 's2', 's3']));
    handlers['POST /api/assessments'] = () => created.response;
    renderLesson();
    await sectionHeading("You've finished this lesson");
    await userEvent.click(screen.getByRole('button', { name: 'Take the quiz' }));
    await userEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));
    expect(await screen.findByText(/another screen/)).toBeInTheDocument();

    created.release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText(/another screen/)).toBeInTheDocument();
    expect(screen.queryByText(/quiz screen/)).not.toBeInTheDocument();
  });
});

describe('lesson: review findings', () => {
  it.each([
    [400, 'Unknown section'],
    [404, 'Objective not found'],
    [403, 'Pass the previous domain exam to unlock this domain'],
  ])('asks for a reload, not a retry, when saving progress fails with a %i', async (status, error) => {
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1']));
    handlers['POST /api/lessons/1.1/progress'] = () => json(status, { error });
    renderLesson();
    await sectionHeading('The CIA triad');
    await userEvent.click(next());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't save your progress. This lesson may have changed since you opened it: reload the page to continue.");
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'The CIA triad' })).toBeInTheDocument();
  });

  it('asks for a reload, not a retry, when an answer is rejected', async () => {
    handlers['POST /api/answers'] = () => json(404, { error: 'Question not found' });
    renderLesson();
    await sectionHeading('Control categories');
    await answerCheck('Technical');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't check your answer. This lesson may have changed since you opened it: reload the page and try again.");
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('refreshes the study path when a section is saved, so the map is up to date on return', async () => {
    const path = {
      domains: [{
        id: 1, title: 'General Security Concepts', weight: 12, unlocked: true, examPassed: false, hasContent: true,
        objectives: [{ id: '1.1', title: 'Security controls', published: true, lessonDone: false, quizPassed: false, mastery: 0 }],
      }],
    };
    handlers['GET /api/path'] = () => json(200, path);
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1', 's2']));
    handlers['POST /api/lessons/1.1/progress'] = () => {
      path.domains[0]!.objectives[0]!.lessonDone = true;
      return json(200, saved(['s1', 's2', 's3'], 50));
    };
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RewardsContext.Provider value={{ report }}>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route path="/" element={<PathPage />} />
              <Route path="/lesson/:objective" element={<LessonPage />} />
            </Routes>
          </MemoryRouter>
        </RewardsContext.Provider>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('link', { name: '1.1 Security controls' }));
    await sectionHeading('Summary');
    expect(requests('GET /api/path')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Finish lesson' }));
    await sectionHeading("You've finished this lesson");
    await waitFor(() => expect(requests('GET /api/path')).toHaveLength(2));

    // Back on the map the new state is there at once: no moment with "Lesson not done".
    await userEvent.click(screen.getByRole('link', { name: 'Back to the study path' }));
    expect(screen.getByText('Lesson done')).toBeInTheDocument();
    expect(screen.queryByText('Lesson not done')).not.toBeInTheDocument();
  });

  it('counts only sections that the lesson still has in the progress bar', async () => {
    handlers['GET /api/lessons/1.1'] = () => json(200, { lesson: lesson(), progress: { sectionsDone: ['s1', 'old-2', 'old-3', 'old-4'], completedAt: null } });
    renderLesson();
    await sectionHeading('The CIA triad');
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(progress()).toHaveAttribute('aria-valuemax', '3');
    expect(progress()).toHaveAttribute('aria-valuetext', '1 of 3 sections complete');
  });

  it('reports what each response earned to the rewards provider, once, and leaves the header totals to it', async () => {
    const client = createQueryClient();
    client.setQueryData(['dashboard'], { xp: 0, level: 1, nextLevelXp: 100, streak: 0 });
    handlers['POST /api/answers'] = () => json(200, { feedback: right, xp: 10, newBadges: ['hundred-correct'] });
    handlers['POST /api/lessons/1.1/progress'] = () => json(200, saved(['s1']));
    renderLesson(client);
    await sectionHeading('Control categories');
    expect(report).not.toHaveBeenCalled();

    // An answer to an inline check.
    await answerCheck('Technical');
    await waitFor(() => expect(next()).toBeEnabled());
    expect(report.mock.calls).toEqual([[{ xp: 10, newBadges: ['hundred-correct'] }]]);

    // A saved section that earned nothing is reported as it came; the provider does nothing with it.
    await userEvent.click(next());
    await sectionHeading('The CIA triad');
    expect(report.mock.calls.slice(1)).toEqual([[{ xp: 0, newBadges: [] }]]);

    // The section that completes the lesson.
    handlers['POST /api/lessons/1.1/progress'] = () => json(200, { ...saved(['s1', 's2', 's3'], 50), newBadges: ['first-lesson'] });
    await userEvent.click(next());
    await sectionHeading('Summary');
    expect(report.mock.calls.slice(2)).toEqual([[{ xp: 50, newBadges: ['first-lesson'] }]]);
    expect(report).toHaveBeenCalledTimes(3);
    // Reading the totals again is the provider's work: the lesson does not ask for it a second time.
    expect(client.getQueryState(['dashboard'])!.isInvalidated).toBe(false);
  });

  it('shows the other lesson when the objective in the address changes', async () => {
    handlers['GET /api/lessons/1.1'] = () => json(200, response(['s1']));
    handlers['GET /api/lessons/1.2'] = () =>
      json(200, {
        lesson: { objective: '1.2', title: 'Fundamental concepts', minutes: 9, sections: [{ id: 's1', title: 'Why it matters', blocks: [{ kind: 'html', html: '<p>Other text.</p>' }] }] },
        progress: { sectionsDone: [], completedAt: null },
      });
    handlers['POST /api/lessons/1.2/progress'] = () => json(200, { sectionsDone: ['s1'], completedAt: '2026-11-10T10:00:00.000Z', xp: 50, newBadges: [] });
    renderLesson();
    await sectionHeading('The CIA triad');

    await userEvent.click(screen.getByRole('link', { name: 'Other lesson' }));
    await sectionHeading('Why it matters');
    expect(screen.getByRole('heading', { level: 1, name: 'Fundamental concepts' })).toBeInTheDocument();
    expect(screen.getByText('Section 1 of 1')).toBeInTheDocument();
    expect(progress()).toHaveAttribute('aria-valuenow', '0');
    expect(screen.queryByText('Three goals.')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Finish lesson' }));
    await sectionHeading("You've finished this lesson");
    expect(bodies('POST /api/lessons/1.2/progress')).toEqual([{ sectionId: 's1' }]);
  });

  it('offers "Try again" when the lesson cannot be loaded, says that it is loading, and recovers', async () => {
    handlers['GET /api/lessons/1.1'] = () => json(500, { error: 'Internal error' });
    renderLesson();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this lesson.");

    const again = deferred(200, response());
    handlers['GET /api/lessons/1.1'] = () => again.response;
    const button = screen.getByRole('button', { name: 'Try again' });
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading lesson…')).toHaveAttribute('role', 'status');

    again.release();
    await sectionHeading('Control categories');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('makes a block that scrolls sideways reachable by keyboard, and leaves other blocks alone', async () => {
    const wide = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.querySelector('table') || this.tagName === 'PRE' ? 900 : 300;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    const sections = lesson().sections;
    sections[0]!.blocks = [
      { kind: 'html', html: '<p>Plain text.</p>' },
      { kind: 'html', html: '<table><tbody><tr><td>A wide table</td></tr></tbody></table>' },
      { kind: 'html', html: '<pre><code>a very long line of code</code></pre>' },
    ];
    handlers['GET /api/lessons/1.1'] = () => json(200, response([], { sections }));
    renderLesson();
    await sectionHeading('Control categories');

    const table = screen.getByRole('region', { name: 'Wide content: scroll sideways to see all of it' });
    expect(table).toHaveAttribute('tabindex', '0');
    expect(within(table).getByText('A wide table')).toBeInTheDocument();
    const code = screen.getByRole('region', { name: 'Code: scroll sideways to see all of it' });
    expect(code.tagName).toBe('PRE');
    expect(code).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('Plain text.').closest('[tabindex]')).toBeNull();
    wide.mockRestore();
  });
});

describe('lesson: second review round', () => {
  it('a marked check never sends its answer again, even before the page has stored the result', async () => {
    handlers['POST /api/answers'] = () => json(200, { feedback: right, xp: 10, newBadges: [] });
    const onAnswered = vi.fn();
    // The parent here never passes `result` back, which holds the check in the moment between the
    // response and the page's next render: the button is still there.
    render(<InlineCheck question={single} onAnswered={onAnswered} />);
    read();
    await userEvent.click(screen.getByRole('radio', { name: 'Technical' }));
    const button = screen.getByRole('button', { name: 'Check answer' });
    await userEvent.click(button);
    await waitFor(() => expect(onAnswered).toHaveBeenCalledTimes(1));

    await userEvent.click(button);
    await userEvent.dblClick(button);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests('POST /api/answers')).toHaveLength(1);
    expect(onAnswered).toHaveBeenCalledTimes(1);
  });

  it('a failed check can be sent again', async () => {
    handlers['POST /api/answers'] = () => json(503, { error: 'Service unavailable' });
    render(<InlineCheck question={single} onAnswered={vi.fn()} />);
    read();
    await userEvent.click(screen.getByRole('radio', { name: 'Technical' }));
    await userEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    // Straight away: a failure does not start the pause again.
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(requests('POST /api/answers')).toHaveLength(2));
  });

  it('a marked check only marks the study path as out of date; a saved section fetches it again', async () => {
    const client = createQueryClient();
    handlers['GET /api/path'] = () => json(200, { domains: [] });
    await client.fetchQuery({ queryKey: ['path'], queryFn: () => fetch('/api/path').then((r) => r.json()) });
    expect(requests('GET /api/path')).toHaveLength(1);
    handlers['POST /api/answers'] = () => json(200, { feedback: right, xp: 10, newBadges: [] });
    handlers['POST /api/lessons/1.1/progress'] = () => json(200, saved(['s1']));
    renderLesson(client);
    await sectionHeading('Control categories');

    await answerCheck('Technical');
    await waitFor(() => expect(client.getQueryState(['path'])!.isInvalidated).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests('GET /api/path')).toHaveLength(1);

    await userEvent.click(next());
    await sectionHeading('The CIA triad');
    await waitFor(() => expect(requests('GET /api/path')).toHaveLength(2));
  });

  it('forgets a retry that was under way when the address changes to another lesson', async () => {
    handlers['GET /api/lessons/1.1'] = () => json(500, { error: 'Internal error' });
    renderLesson();
    await screen.findByRole('alert');
    handlers['GET /api/lessons/1.1'] = () => new Promise<Response>(() => {});
    handlers['GET /api/lessons/1.2'] = () => new Promise<Response>(() => {});
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('aria-busy', 'true');

    await userEvent.click(screen.getByRole('link', { name: 'Other lesson' }));
    // The other lesson is simply loading: no "Try again" left over from the first one.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Loading lesson…');
    expect(requests('GET /api/lessons/1.2')).toHaveLength(1);
  });

  it('puts focus on the lesson title when "Try again" has loaded the lesson', async () => {
    handlers['GET /api/lessons/1.1'] = () => json(500, { error: 'Internal error' });
    renderLesson();
    await screen.findByRole('alert');
    handlers['GET /api/lessons/1.1'] = () => json(200, response());
    const button = screen.getByRole('button', { name: 'Try again' });
    button.focus();
    await userEvent.keyboard('{Enter}');

    await sectionHeading('Control categories');
    // The button that had focus is gone; focus must not fall back to the top of the page.
    expect(screen.getByRole('heading', { level: 1, name: 'Security controls' })).toHaveFocus();
  });

  it('leaves focus alone when a lesson loads normally', async () => {
    renderLesson();
    await sectionHeading('Control categories');
    expect(document.body).toHaveFocus();
  });
});
