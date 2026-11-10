import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import type { Answer } from '../../../../shared/types';
import { api } from '../../api/client';
import type { AssessmentResult, AssessmentView, SubmitResponse } from '../../api/types';
import { Button } from '../../ui/Button';
import { usePressGuard } from '../../ui/pressGuard';
import { usePageTitle } from '../../ui/routeChange';
import { SaveIndicator } from '../../ui/SaveIndicator';
import { QuestionView } from '../questions/QuestionView';
import { answerState } from './answerState';
import { closeExamSaves, examSaves } from './examSaves';
import { ExamTimer } from './ExamTimer';
import { LoadState, pathLink } from './LoadState';
import { FlagIcon, QuestionNavigator } from './QuestionNavigator';
import { ResultsView } from './ResultsView';
import { SubmitDialog } from './SubmitDialog';
import { useAssessment } from './useAssessment';

const examName = (view: AssessmentView) => (view.kind === 'mock' ? 'Practice exam' : `Domain ${view.scope} exam`);

/** When the time is up, how long the saves still under way, one retry of a rejected one included, may hold up the submission. */
const LAST_SAVES_MS = 3000;
/** A submission that has had no answer for this long is given up; submitting again is safe (the server repeats the result). */
const SUBMIT_TIMEOUT_MS = 20_000;
/** Without the server's time: how often the server is asked whether the exam is over, once the device clock says so. */
const RECHECK_MS = 15_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No answer in time')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** "1", "1 and 2", "1, 2 and 5". */
const listed = (numbers: number[]) =>
  numbers.length < 2 ? numbers.join('') : `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;

export function ExamPage() {
  const { id = '' } = useParams();
  return <Exam key={id} id={id} />;
}

function Exam({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { query, view, clockOffsetMs, reload, finishedHere } = useAssessment(id);
  // A finalized exam has nothing left to save.
  const finalizedId = view?.result ? view.id : undefined;
  useEffect(() => {
    if (finalizedId !== undefined) closeExamSaves(queryClient, finalizedId);
  }, [queryClient, finalizedId]);

  if (!view) return <LoadState query={query} noun="exam" />;
  if (view.kind === 'objective') return <Navigate to={`/quiz/${view.id}`} replace />;
  if (view.result) return <ExamResults view={view} result={view.result} fresh={finishedHere} />;
  return <ExamRunner view={view} offsetMs={clockOffsetMs} reload={reload} />;
}

function ExamResults({ view, result, fresh }: { view: AssessmentView; result: AssessmentResult; fresh: boolean }) {
  usePageTitle(`${examName(view)} results`);
  return (
    <ResultsView
      title={`${examName(view)} results`}
      passTitle={examName(view)}
      kind={view.kind}
      partial={view.partial}
      result={result}
      questions={view.questions}
      answers={view.answers}
      feedback={view.feedback}
      fresh={fresh}
    >
      {view.kind === 'mock' ? (
        <Link to="/exam" className="text-accent underline underline-offset-2">
          Back to practice exams
        </Link>
      ) : (
        pathLink
      )}
    </ResultsView>
  );
}

/**
 * Where a submission stands. `saving`: waiting for the answers still on their way. `unsaved`: the server
 * does not have every answer, and the learner decides. `sending`: the submission is with the server.
 * `failed`: it did not get there. `reading`: the exam is finalized and the results are being read;
 * `unread`: they could not be read.
 */
type Phase = 'saving' | 'unsaved' | 'sending' | 'failed' | 'reading' | 'unread' | null;

function ExamRunner({
  view,
  offsetMs,
  reload,
}: {
  view: AssessmentView;
  /** How far the server's clock is ahead of this device's; null when the server's time is not known. */
  offsetMs: number | null;
  reload(): Promise<AssessmentView>;
}) {
  const { questions } = view;
  const total = questions.length;
  const queryClient = useQueryClient();
  usePageTitle(examName(view));
  // One set of saves per exam, shared by every visit to this page (see examSaves).
  const [saves] = useState(() => examSaves(queryClient, view.id));
  const { queue } = saves;

  // What the server has, with what this device has not managed to save yet laid over it: a learner who
  // comes back while a save is retrying sees their own latest answers and flags.
  const [answers, setAnswers] = useState(() => {
    const local = { ...view.answers };
    for (const body of saves.unconfirmed.values()) if (body.answer) local[body.questionId] = body.answer;
    return local;
  });
  const [flags, setFlags] = useState<ReadonlySet<string>>(() => {
    const local = new Set(view.flags);
    for (const body of saves.unconfirmed.values()) {
      if (body.flagged === true) local.add(body.questionId);
      if (body.flagged === false) local.delete(body.questionId);
    }
    return local;
  });
  const states = Object.fromEntries(questions.map((q) => [q.id, answerState(q, answers[q.id])]));
  const [index, setIndex] = useState(() => Math.max(0, questions.findIndex((q) => states[q.id] !== 'answered')));
  const [confirming, setConfirming] = useState(false);
  const [expired, setExpired] = useState(false);
  const [phase, setPhase] = useState<Phase>(null);
  // How the exam ended, once it has: submitted from here, or closed by the server.
  const [ended, setEnded] = useState<'submitted' | 'closed' | null>(null);
  // The numbers of the questions whose answers the server does not have, when the learner is asked about them.
  const [lost, setLost] = useState<number[]>([]);
  // Without the server's time: the device clock has run out, and the server is being asked instead.
  const [deviceClockOut, setDeviceClockOut] = useState(false);

  // Each submission attempt has a number; an attempt that has been overtaken or cancelled stops.
  const attempt = useRef(0);
  const posting = useRef(false);
  const reading = useRef(false);
  const timeUp = useRef(false);

  const heading = useRef<HTMLHeadingElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const headingId = useId();
  // Each phase of a submission brings its own buttons (the three about unsaved answers; Try again), often
  // where the ones before were. A press on one of those that arrives straight after a phase began is ignored.
  const guard = usePressGuard(phase);

  // The saves tell the page that is open when the server refuses one because the exam is over.
  useEffect(() => {
    saves.onClosed = () => void readResults('closed');
  });
  // This page holds the saves while it is mounted. When no page holds them and nothing is left to save,
  // they are forgotten; otherwise they wait for the learner to come back.
  useEffect(() => {
    saves.acquire();
    return () => {
      saves.onClosed = null;
      saves.release();
    };
  }, [saves]);

  // The bar with the timer stays at the top of the window and covers what scrolls under it. Anything that
  // is brought into view (a control that takes focus with Shift+Tab, for one) must stop below it.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const measure = () => {
      root.style.scrollPaddingTop = `${el.offsetHeight + 8}px`;
    };
    measure();
    // Its height changes when what it says about saving wraps.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.scrollPaddingTop = '';
    };
  }, []);

  // The page scrolls to a new question, so the second tap of a double tap on Next or Previous lands on
  // something of that question. Its flag takes no press for a moment (its answers: see `QuestionView`).
  const questionGuard = usePressGuard(index);

  // On a new question, focus goes to its heading.
  const shown = useRef(index);
  useEffect(() => {
    if (shown.current === index) return;
    shown.current = index;
    heading.current?.focus();
  }, [index]);

  // When the time is up the inputs are switched off, which would drop focus from one of them: it goes to
  // the line that says what is happening.
  useEffect(() => {
    if (expired) status.current?.focus();
  }, [expired]);

  // Without the server's time the exam is never ended on the device clock's word. Once that clock has
  // run out, the server is asked now and then: it closes the exam at its own deadline.
  useEffect(() => {
    if (!deviceClockOut || offsetMs !== null) return;
    const timer = setInterval(() => void reload().catch(() => {}), RECHECK_MS);
    return () => clearInterval(timer);
  }, [deviceClockOut, offsetMs, reload]);

  /** A button that is about to disappear was pressed: keep keyboard focus in the exam. */
  const backToQuestion = () => heading.current?.focus();

  /** The exam is finalized on the server: read it again, which puts the results on screen. */
  async function readResults(how: 'submitted' | 'closed') {
    if (reading.current) return;
    reading.current = true;
    attempt.current++; // a submission that was still waiting stops here
    setConfirming(false);
    setEnded(how);
    setPhase('reading');
    try {
      const fresh = await reload();
      if (!fresh.result) setPhase('unread');
    } catch {
      setPhase('unread');
    } finally {
      reading.current = false;
    }
  }

  /** The numbers of the questions whose answer the server has not confirmed. */
  const unsavedAnswers = () => questions.flatMap((q, i) => (saves.unconfirmed.get(q.id)?.answer ? [i + 1] : []));

  async function submit({ anyway = false } = {}) {
    if (posting.current || reading.current) return;
    const mine = ++attempt.current;
    setPhase('saving');
    if (timeUp.current) {
      // No time to wait or to ask: what is still on its way, and one more try for what was rejected, may
      // hold the submission up for a few seconds at most. The server scores what it has by then.
      let waitedEnough = false;
      const lastSaves = async () => {
        await queue.flush();
        if (waitedEnough || unsavedAnswers().length === 0) return;
        saves.retry();
        await queue.flush();
      };
      await Promise.race([lastSaves(), wait(LAST_SAVES_MS)]);
      waitedEnough = true;
      if (attempt.current !== mine) return;
    } else {
      await queue.flush();
      if (attempt.current !== mine) return;
      // `flush` also resolves when a save was rejected, and the indicator's Dismiss button hides that. What
      // counts is whether the server has every answer the learner sees as given.
      if (unsavedAnswers().length > 0 && !anyway) {
        setLost(unsavedAnswers());
        setPhase('unsaved');
        return;
      }
    }
    posting.current = true;
    setPhase('sending');
    try {
      await withTimeout(api.post<SubmitResponse>(`assessments/${view.id}/submit`), SUBMIT_TIMEOUT_MS);
    } catch {
      if (attempt.current === mine) setPhase('failed');
      return;
    } finally {
      posting.current = false;
    }
    if (attempt.current === mine) await readResults('submitted');
  }

  function expire() {
    if (offsetMs === null) {
      // Only the device clock says so, and it may be wrong.
      if (!deviceClockOut) {
        setDeviceClockOut(true);
        void reload().catch(() => {});
      }
      return;
    }
    if (timeUp.current) return;
    timeUp.current = true;
    setExpired(true);
    setConfirming(false);
    void submit();
  }

  function saveAgain() {
    if (!guard.settled()) return;
    backToQuestion();
    saves.retry();
    void submit();
  }

  // Not held back by the pause: Cancel is the one way to stop a submission that is about to go, and a
  // press on it that is swallowed lets the exam through.
  function cancel() {
    backToQuestion();
    attempt.current++;
    setPhase(null);
  }

  const question = questions[index];
  const waiting = phase === 'saving' || phase === 'sending' || phase === 'reading';
  const locked = expired || waiting || phase === 'unread';
  const answeredCount = questions.filter((q) => states[q.id] === 'answered').length;
  const flagged = question !== undefined && flags.has(question.id);

  function answer(questionId: string, a: Answer) {
    if (locked) return;
    setAnswers((prev) => ({ ...prev, [questionId]: a }));
    saves.save(questionId, { questionId, answer: a });
  }

  function toggleFlag(questionId: string) {
    if (locked || !questionGuard.settled()) return;
    const on = !flags.has(questionId);
    setFlags((prev) => {
      const next = new Set(prev);
      if (on) next.add(questionId);
      else next.delete(questionId);
      return next;
    });
    saves.save(`flag:${questionId}`, { questionId, flagged: on });
  }

  const progress =
    phase === 'saving'
      ? expired ? 'Time is up. Saving your answers…' : 'Saving your answers before submitting…'
      : phase === 'sending'
        ? expired ? 'Time is up. Submitting your exam…' : 'Submitting your exam…'
        : phase === 'reading'
          ? ended === 'submitted' ? 'Your exam was submitted. Loading your results…' : 'This exam has ended. Loading your results…'
          : expired ? 'Time is up.' : '';

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{examName(view)}</h1>
        {view.partial && <p className="text-sm text-muted">Partial practice exam: it does not cover all five domains yet.</p>}
      </header>

      <div ref={bar} className="sticky top-0 z-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border bg-bg py-3">
        {view.deadlineAt && <ExamTimer deadlineAt={view.deadlineAt} offsetMs={offsetMs} onExpire={expire} />}
        <SaveIndicator queue={queue} />
        {/* Never disabled: a disabled button would drop keyboard focus. Presses while busy do nothing. */}
        <Button className="ml-auto" onClick={() => !locked && setConfirming(true)}>
          Submit exam
        </Button>
      </div>

      {/* Always in the page, so that what it says is announced when it appears. */}
      <div className={progress ? 'flex flex-wrap items-center gap-3 text-sm' : 'sr-only'}>
        <p ref={status} role="status" aria-label="Submission" tabIndex={-1}>
          {progress}
        </p>
        {phase === 'saving' && !expired && (
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
        )}
      </div>
      {/* In the two boxes below only the message is the alert: the buttons beside it are not read out with it. */}
      {phase === 'unsaved' && (
        <div className="space-y-3 rounded-lg border border-bad bg-surface p-4 text-sm">
          <p role="alert">
            {lost.length === 1
              ? `Your answer to question ${lost[0]} could not be saved. If you submit now, your latest answer to it will not count.`
              : `Your answers to questions ${listed(lost)} could not be saved. If you submit now, your latest answers to them will not count.`}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={saveAgain}>Try saving again</Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (!guard.settled()) return;
                backToQuestion();
                void submit({ anyway: true });
              }}
            >
              Submit anyway
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (!guard.settled()) return;
                backToQuestion();
                setPhase(null);
              }}
            >
              Keep working
            </Button>
          </div>
        </div>
      )}
      {(phase === 'failed' || phase === 'unread') && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-bad bg-surface p-4 text-sm">
          <p role="alert">
            {phase === 'unread'
              ? `${ended === 'submitted' ? 'Your exam was submitted.' : 'This exam has ended.'} Couldn't load the results.`
              : expired
                ? "Couldn't submit your exam. The answers that were saved will be scored either way."
                : "Couldn't submit your exam. Your saved answers are safe, and you can keep working."}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              if (!guard.settled()) return;
              backToQuestion();
              // Once the exam is finalized there is nothing to submit again, only results to read.
              void (phase === 'unread' ? readResults(ended ?? 'closed') : submit());
            }}
          >
            Try again
          </Button>
        </div>
      )}

      {question ? (
        // One column that may shrink under its content: an `auto` column grows to the widest menu of a
        // match question and pushes the page sideways on a narrow screen.
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <section aria-labelledby={headingId} className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id={headingId} ref={heading} tabIndex={-1} className="font-mono text-sm uppercase tracking-wide text-accent">
                {`Question ${index + 1} of ${total}`}
              </h2>
              <button
                type="button"
                aria-pressed={flagged}
                onClick={() => toggleFlag(question.id)}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:border-accent ${
                  flagged ? 'border-warn font-semibold text-warn' : 'border-border'
                }`}
              >
                <FlagIcon filled={flagged} />
                <span>Flag for review</span>
              </button>
            </div>
            <QuestionView
              key={question.id}
              question={question}
              value={answers[question.id] ?? null}
              onChange={(a) => answer(question.id, a)}
              disabled={locked}
            />
            {question.type === 'order' && !answers[question.id] && (
              <p className="text-sm text-muted">Not answered yet. Move an item to record your order.</p>
            )}
            {states[question.id] === 'partial' && (
              <p className="text-sm text-muted">
                {question.type === 'match'
                  ? 'Partly answered. It counts as unanswered until every item has a match.'
                  : 'Partly answered. It counts as unanswered until every item is placed.'}
              </p>
            )}
            <div role="group" aria-label="Exam questions" className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
              {index > 0 ? (
                <Button variant="secondary" onClick={() => setIndex(index - 1)}>
                  Previous
                </Button>
              ) : (
                <span />
              )}
              {index < total - 1 && (
                <Button variant="secondary" onClick={() => setIndex(index + 1)}>
                  Next
                </Button>
              )}
            </div>
          </section>
          <QuestionNavigator questions={questions} current={index} states={states} flagged={flags} onSelect={setIndex} />
        </div>
      ) : (
        <p>This exam has no questions.</p>
      )}

      {confirming && (
        <SubmitDialog
          unanswered={total - answeredCount}
          partial={questions.filter((q) => states[q.id] === 'partial').length}
          flagged={questions.filter((q) => flags.has(q.id)).length}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void submit();
          }}
        />
      )}
    </div>
  );
}
