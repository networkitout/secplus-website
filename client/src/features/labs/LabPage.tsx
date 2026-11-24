import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { Answer, Feedback, PublicQuestion } from '../../../../shared/types';
import { api, ApiError, isUnavailable } from '../../api/client';
import type { LabSubmitResponse, LabView } from '../../api/types';
import { wholePercent } from '../../lib/percent';
import { Button } from '../../ui/Button';
import { usePressGuard } from '../../ui/pressGuard';
import { usePageTitle } from '../../ui/routeChange';
import { Mark } from '../questions/FeedbackPanel';
import { initialAnswer, isComplete, QuestionView } from '../questions/QuestionView';
import { ScreenCelebration, useRewards } from '../rewards/RewardsProvider';
import { Scenario } from './Scenario';

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
                ? `Partly correct (${wholePercent(feedback.fraction * 100)}%)`
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
  const { report } = useRewards();
  const { steps } = lab;
  usePageTitle(`Lab: ${lab.title}`);
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
  const celebrationId = useId();
  // "Submit lab" gives way to the results with "Try again", and "Try again" to a new attempt with "Submit
  // lab". A press that arrives straight after either change is ignored.
  const guard = usePressGuard(`${attempt}:${outcome ? 'results' : 'steps'}`);

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
   * The outcome of a submission arrives here, once. What it earned goes to the rewards provider, which
   * reads the header's totals again; the path and the list of labs are read again when they are next shown.
   */
  function submitted(result: LabSubmitResponse) {
    setCelebrating(result.passed);
    report({ xp: result.xp, newBadges: result.newBadges });
    for (const key of ['path', 'labs']) void queryClient.invalidateQueries({ queryKey: [key] });
  }

  async function submit() {
    if (!guard.settled() || sending.current || outcome) return;
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
      // The request guard is released below, before React has shown the results: a press that is handled
      // in between must not submit the lab again.
      guard.restart();
      submitted(result);
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function tryAgain() {
    if (!guard.settled()) return;
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
              {/* The celebration is read with this heading when it takes focus: it describes it. */}
              <h2 ref={resultsHeading} tabIndex={-1} aria-describedby={celebrating ? celebrationId : undefined} className="rounded-sm text-xl font-semibold">
                Results
              </h2>
              {celebrating && (
                <div ref={celebrationBox}>
                  <ScreenCelebration
                    textId={celebrationId}
                    kind="lab-pass"
                    title={lab.title}
                    detail={result.xp > 0 ? `+${result.xp} XP` : undefined}
                    onDone={dismissCelebration}
                  />
                </div>
              )}
              <section aria-label="Score" className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-4">
                  <p className="font-mono text-4xl font-semibold">{`${wholePercent(result.scorePct)}%`}</p>
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
                <Button disabled={incomplete.length > 0} aria-describedby={noteId} onClick={() => void submit()}>
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
