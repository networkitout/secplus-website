import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { Link, useParams } from 'react-router';
import type { Answer, Feedback, PublicQuestion } from '../../../../shared/types';
import { api, ApiError, isUnavailable } from '../../api/client';
import type { LabSubmitResponse, LabView } from '../../api/types';
import { Button } from '../../ui/Button';
import { Celebration } from '../../ui/Celebration';
import { Mark } from '../questions/FeedbackPanel';
import { initialAnswer, isComplete, QuestionView } from '../questions/QuestionView';

const PASS_PCT = 80;
const EYEBROW = 'font-mono text-sm uppercase tracking-wide text-accent';

const labsLink = (
  <Link to="/labs" className="text-accent underline underline-offset-2">
    Back to labs
  </Link>
);

export function LabPage() {
  const { id = '' } = useParams();
  // The steps of a lab do not change while it is open, so it is read once per visit.
  const lab = useQuery({
    queryKey: ['lab', id],
    queryFn: () => api.get<LabView>(`labs/${encodeURIComponent(id)}`),
    staleTime: Infinity,
  });

  if (lab.data) return <LabRunner key={id} lab={lab.data} />;

  if (lab.isError) {
    const status = lab.error instanceof ApiError ? lab.error.status : 0;
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Lab</h1>
        <p role="alert">
          {status === 403 ? lab.error.message : status === 404 ? "This lab isn't available." : "Couldn't load this lab."}
        </p>
        {status !== 403 && status !== 404 && <Button onClick={() => void lab.refetch()}>Try again</Button>}
        <p>{labsLink}</p>
      </div>
    );
  }

  return (
    <p role="status" className="text-muted">
      Loading lab…
    </p>
  );
}

/**
 * The scenario stays in view while the steps are worked through: beside them on a wide screen, across the
 * top on a narrow one, where it scrolls within a limited height and can be folded away.
 */
function Scenario({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  const [scrolls, setScrolls] = useState(false);
  const box = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const panelId = useId();

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const measure = () => {
      // Across the top it covers what scrolls under it, so anything brought into view (a focused
      // control, for one) must stop below it. Beside the steps it covers nothing.
      const acrossTop = getComputedStyle(el).top === '0px';
      root.style.scrollPaddingTop = acrossTop ? `${el.offsetHeight + 8}px` : '';
      // Text that scrolls within the box must be reachable by keyboard.
      setScrolls(panel.current !== null && panel.current.scrollHeight > panel.current.clientHeight + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.scrollPaddingTop = '';
    };
  }, []);

  return (
    <section
      ref={box}
      aria-labelledby={headingId}
      className="sticky top-0 z-10 -mx-4 border-b border-border bg-bg px-4 py-3 lg:top-4 lg:mx-0 lg:rounded-lg lg:border lg:bg-surface lg:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className={EYEBROW}>
          Scenario
        </h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent lg:hidden"
        >
          {open ? 'Hide scenario' : 'Show scenario'}
        </button>
      </div>
      <div
        id={panelId}
        ref={panel}
        {...(scrolls && { tabIndex: 0, role: 'group', 'aria-label': 'Scenario text' })}
        className={`mt-2 max-h-[30vh] overflow-y-auto rounded-sm lg:max-h-[calc(100vh-7rem)] ${open ? '' : 'hidden lg:block'}`}
      >
        <p className="whitespace-pre-line">{text}</p>
      </div>
    </section>
  );
}

const ignore = () => {};

function Step({
  number,
  total,
  question,
  value,
  onChange,
  feedback,
  disabled,
}: {
  number: number;
  total: number;
  question: PublicQuestion;
  value: Answer | null;
  onChange(a: Answer): void;
  feedback?: Feedback;
  disabled: boolean;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h2 id={headingId} className="flex flex-wrap items-baseline gap-x-2">
        <span className={EYEBROW}>{feedback ? `Step ${number} of ${total}: ` : `Step ${number} of ${total}`}</span>
        {feedback && (
          <Mark ok={feedback.correct}>
            {feedback.correct
              ? 'Correct'
              : feedback.fraction > 0
                ? `Partly correct (${Math.round(feedback.fraction * 100)}%)`
                : 'Incorrect'}
          </Mark>
        )}
      </h2>
      <QuestionView question={question} value={value} onChange={onChange} feedback={feedback} disabled={disabled} />
    </section>
  );
}

const stepList = new Intl.ListFormat('en', { type: 'conjunction' });

type Problem = { message: string; canRetry: boolean };

function problemOf(err: unknown): Problem {
  const status = err instanceof ApiError ? err.status : 0;
  if (status === 403 || status === 404) return { message: 'This lab is no longer available.', canRetry: false };
  if (isUnavailable(err) || status >= 500) return { message: "Couldn't submit the lab. Your answers are still here.", canRetry: true };
  return { message: "The server didn't accept these answers. Reload the page to start the lab again.", canRetry: false };
}

function LabRunner({ lab }: { lab: LabView }) {
  const queryClient = useQueryClient();
  const { steps } = lab;
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  // What was sent, with what the server made of it.
  const [outcome, setOutcome] = useState<{ sent: Record<string, Answer>; result: LabSubmitResponse } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  // Set and read in the same tick, which state is not: two clicks in a row must not send twice.
  const sending = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const celebrationBox = useRef<HTMLDivElement>(null);
  const noteId = useId();

  // The button that was pressed is gone: focus goes to the results, or back to the top of a fresh attempt.
  useEffect(() => {
    if (outcome) resultsHeading.current?.focus();
  }, [outcome]);
  const begun = useRef(attempt);
  useEffect(() => {
    if (begun.current === attempt) return;
    begun.current = attempt;
    title.current?.focus();
  }, [attempt]);

  const incomplete = steps.flatMap((step, i) => (isComplete(step, answers[step.id] ?? null) ? [] : [`step ${i + 1}`]));

  /**
   * The outcome of a submission arrives here, once. Its `xp` and `newBadges` are for Task 20's rewards
   * provider; until then the screens that show totals re-read them.
   */
  function submitted(result: LabSubmitResponse) {
    setCelebrating(result.passed);
    for (const key of ['dashboard', 'path', 'labs']) void queryClient.invalidateQueries({ queryKey: [key] });
  }

  async function submit(e: MouseEvent) {
    if (e.detail > 1 || sending.current || outcome) return;
    // Only a lab with every step answered is sent: an order step counts as served, the rest as chosen.
    const sent: Record<string, Answer> = {};
    for (const step of steps) {
      const answer = answers[step.id] ?? initialAnswer(step);
      if (!answer || !isComplete(step, answer)) return;
      sent[step.id] = answer;
    }
    sending.current = true;
    setBusy(true);
    try {
      const result = await api.post<LabSubmitResponse>(`labs/${encodeURIComponent(lab.id)}/submit`, { answers: sent });
      setProblem(null);
      setOutcome({ sent, result });
      submitted(result);
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function tryAgain(e: MouseEvent) {
    // The second click of a double click on "Submit lab" can land here, once the results are shown.
    if (e.detail > 1) return;
    setOutcome(null);
    setAnswers({});
    setCelebrating(false);
    setAttempt(attempt + 1);
  }

  function dismissCelebration() {
    // Its Dismiss button goes with it; do not let focus fall back to the top of the page.
    if (celebrationBox.current?.contains(document.activeElement)) resultsHeading.current?.focus();
    setCelebrating(false);
  }

  const result = outcome?.result;
  return (
    <article className="mx-auto max-w-3xl space-y-6 lg:max-w-none">
      <header className="space-y-1">
        <p className="font-mono text-sm text-muted">Lab</p>
        <h1 ref={title} tabIndex={-1} className="rounded-sm text-2xl font-semibold">
          {lab.title}
        </h1>
      </header>

      <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start lg:gap-8 lg:space-y-0">
        <Scenario text={lab.scenario} />

        <div className="space-y-6">
          {result && (
            <>
              <h2 ref={resultsHeading} tabIndex={-1} className="rounded-sm text-xl font-semibold">
                Results
              </h2>
              {celebrating && (
                <div ref={celebrationBox}>
                  <Celebration
                    kind="quiz-pass"
                    title={`Lab passed: ${lab.title}`}
                    detail={result.xp > 0 ? `+${result.xp} XP` : undefined}
                    onDone={dismissCelebration}
                  />
                </div>
              )}
              <section aria-label="Score" className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-4">
                  {/* Never rounded up to a pass mark that was missed. */}
                  <p className="font-mono text-4xl font-semibold">{`${Math.floor(result.scorePct)}%`}</p>
                  <p className={`text-2xl font-semibold ${result.passed ? 'text-ok' : 'text-warn'}`}>
                    <span aria-hidden="true">{result.passed ? '✓ ' : '○ '}</span>
                    <span>{result.passed ? 'Passed' : 'Not passed'}</span>
                  </p>
                </div>
                <p className="text-sm text-muted">{`You need ${PASS_PCT}% or more to pass a lab.`}</p>
                <p className="font-mono text-sm">{`XP earned: ${result.xp}`}</p>
              </section>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <Button variant={result.passed ? 'secondary' : 'primary'} onClick={tryAgain}>
                  Try again
                </Button>
                {labsLink}
              </div>
            </>
          )}

          {steps.map((step, i) => (
            <Step
              key={`${attempt}:${step.id}`}
              number={i + 1}
              total={steps.length}
              question={step}
              value={outcome ? (outcome.sent[step.id] ?? null) : (answers[step.id] ?? null)}
              onChange={outcome ? ignore : (answer) => setAnswers((all) => ({ ...all, [step.id]: answer }))}
              feedback={result?.steps[step.id]}
              disabled={busy || outcome !== null}
            />
          ))}

          {!outcome && (
            <div className="space-y-3 border-t border-border pt-4">
              {problem && (
                <p role="alert" className="text-sm text-bad">
                  {problem.message} {!problem.canRetry && labsLink}
                </p>
              )}
              <p id={noteId} role="status" className="text-sm text-muted">
                {incomplete.length === 0
                  ? 'Every step has an answer.'
                  : `${incomplete.length} ${incomplete.length === 1 ? 'step still needs' : 'steps still need'} an answer: ${stepList.format(incomplete)}.`}
              </p>
              {(!problem || problem.canRetry) && (
                <Button disabled={incomplete.length > 0} aria-describedby={noteId} onClick={(e) => void submit(e)}>
                  {busy ? 'Submitting…' : problem ? 'Try again' : 'Submit lab'}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
