import { useEffect, useId, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import type { Answer } from '../../../../shared/types';
import { api, ApiError } from '../../api/client';
import { createSaveQueue, guardUnload } from '../../api/saveQueue';
import type { AnswerSaveResponse, AssessmentResult, AssessmentView, SubmitResponse } from '../../api/types';
import { Button } from '../../ui/Button';
import { SaveIndicator } from '../../ui/SaveIndicator';
import { QuestionView } from '../questions/QuestionView';
import { ExamTimer } from './ExamTimer';
import { LoadState, pathLink } from './LoadState';
import { FlagIcon, QuestionNavigator } from './QuestionNavigator';
import { ResultsView } from './ResultsView';
import { useServerClockOffset } from './serverClock';
import { SubmitDialog } from './SubmitDialog';
import { useAssessment } from './useAssessment';

const examName = (view: AssessmentView) => (view.kind === 'mock' ? 'Practice exam' : `Domain ${view.scope} exam`);

export function ExamPage() {
  const { id = '' } = useParams();
  return <Exam key={id} id={id} />;
}

function Exam({ id }: { id: string }) {
  const { query, reload, finishedHere } = useAssessment(id);
  const offsetMs = useServerClockOffset();
  const view = query.data;
  if (!view) return <LoadState query={query} noun="exam" />;
  if (view.kind === 'objective') return <Navigate to={`/quiz/${view.id}`} replace />;
  if (view.result) return <ExamResults view={view} result={view.result} fresh={finishedHere} />;
  // The countdown needs the server's clock; it is read alongside the exam.
  if (offsetMs === undefined) return <LoadState query={query} noun="exam" />;
  return <ExamRunner view={view} offsetMs={offsetMs} reload={reload} />;
}

function ExamResults({ view, result, fresh }: { view: AssessmentView; result: AssessmentResult; fresh: boolean }) {
  return (
    <ResultsView
      title={`${examName(view)} results`}
      passTitle={`${examName(view)} passed`}
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
 * Where a submission stands. `saving`: waiting for the answers still on their way. `unsaved`: an answer was
 * rejected, and the learner decides. `sending`: the submission is with the server. `failed`: it did not get
 * there. `closed`: the server has finalized the exam already and the results are being read;
 * `closed-failed`: they could not be read.
 */
type Phase = 'saving' | 'unsaved' | 'sending' | 'failed' | 'closed' | 'closed-failed' | null;

function ExamRunner({ view, offsetMs, reload }: { view: AssessmentView; offsetMs: number; reload(): Promise<AssessmentView> }) {
  const { questions } = view;
  const total = questions.length;
  const url = `assessments/${view.id}`;

  const [answers, setAnswers] = useState(view.answers);
  const [flags, setFlags] = useState<ReadonlySet<string>>(() => new Set(view.flags));
  const [index, setIndex] = useState(() => Math.max(0, questions.findIndex((q) => !view.answers[q.id])));
  const [confirming, setConfirming] = useState(false);
  const [expired, setExpired] = useState(false);
  const [phase, setPhase] = useState<Phase>(null);

  // A queue of this exam's own: its state is this exam's state (shown beside the timer), and a save that
  // was rejected is known here, where the learner can be asked what to do about it.
  const [queue] = useState(() => createSaveQueue());
  // The newest save per key that the server has not confirmed. After a flush these are the rejected ones.
  const unconfirmed = useRef(new Map<string, object>());
  // Each submission attempt has a number; an attempt that has been overtaken or cancelled stops.
  const attempt = useRef(0);
  const posting = useRef(false);
  const closing = useRef(false);
  const timeUp = useRef(false);

  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  // Warn before the page is closed while a save is on its way; the guard stays until the queue is empty.
  useEffect(() => {
    const remove = guardUnload(queue);
    return () => void queue.flush().then(remove);
  }, [queue]);

  // On a new question, focus goes to its heading.
  const shown = useRef(index);
  useEffect(() => {
    if (shown.current === index) return;
    shown.current = index;
    heading.current?.focus();
  }, [index]);

  /** The server has finalized the exam (its deadline passed, or it was submitted elsewhere): read the results. */
  async function closed() {
    if (closing.current) return;
    closing.current = true;
    attempt.current++;
    setConfirming(false);
    setPhase('closed');
    try {
      const fresh = await reload(); // the page now shows the results
      if (!fresh.result) setPhase('closed-failed');
    } catch {
      setPhase('closed-failed');
    } finally {
      closing.current = false;
    }
  }

  function save(key: string, body: object) {
    unconfirmed.current.set(key, body);
    queue.enqueue(key, async () => {
      try {
        await api.put<AnswerSaveResponse>(`${url}/answers`, body);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409)) throw err;
        // Nothing more can be saved, so this is not a save to retry or to report as lost.
        void closed();
      }
      if (unconfirmed.current.get(key) === body) unconfirmed.current.delete(key);
    });
  }

  async function submit({ anyway = false } = {}) {
    if (posting.current || closing.current) return;
    const mine = ++attempt.current;
    setPhase('saving');
    await queue.flush();
    if (attempt.current !== mine) return;
    // `flush` also resolves when a save was rejected. The learner is asked, unless the time is up.
    if (queue.state() === 'failed' && !anyway && !timeUp.current) {
      setPhase('unsaved');
      return;
    }
    posting.current = true;
    setPhase('sending');
    try {
      await api.post<SubmitResponse>(`${url}/submit`);
      await reload(); // the page now shows the results
    } catch {
      if (attempt.current === mine) setPhase('failed');
    } finally {
      posting.current = false;
    }
  }

  function expire() {
    if (timeUp.current) return;
    timeUp.current = true;
    setExpired(true);
    setConfirming(false);
    void submit();
  }

  function saveAgain() {
    for (const [key, body] of [...unconfirmed.current]) save(key, body);
    void submit();
  }

  function submitAnyway() {
    queue.dismiss();
    void submit({ anyway: true });
  }

  function cancel() {
    attempt.current++;
    setPhase(null);
  }

  const question = questions[index];
  const waiting = phase === 'saving' || phase === 'sending' || phase === 'closed';
  const locked = expired || waiting || phase === 'closed-failed';
  const answered = new Set(questions.filter((q) => answers[q.id]).map((q) => q.id));
  const flagged = question !== undefined && flags.has(question.id);

  function answer(questionId: string, a: Answer) {
    if (locked) return;
    setAnswers((prev) => ({ ...prev, [questionId]: a }));
    save(questionId, { questionId, answer: a });
  }

  function toggleFlag(questionId: string) {
    if (locked) return;
    const on = !flags.has(questionId);
    setFlags((prev) => {
      const next = new Set(prev);
      if (on) next.add(questionId);
      else next.delete(questionId);
      return next;
    });
    save(`flag:${questionId}`, { questionId, flagged: on });
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{examName(view)}</h1>
        {view.partial && <p className="text-sm text-muted">Partial practice exam: it does not cover all five domains yet.</p>}
      </header>

      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border bg-bg py-3">
        {view.deadlineAt && <ExamTimer deadlineAt={view.deadlineAt} offsetMs={offsetMs} onExpire={expire} />}
        <SaveIndicator queue={queue} />
        {/* Never disabled: a disabled button would drop keyboard focus. Presses while busy do nothing. */}
        <Button className="ml-auto" onClick={() => !locked && setConfirming(true)}>
          Submit exam
        </Button>
      </div>

      {/* Always in the page, so that what it says is announced when it appears. */}
      <div className={waiting ? 'flex flex-wrap items-center gap-3 text-sm' : 'sr-only'}>
        <p role="status" aria-label="Submission">
          {phase === 'saving' && (expired ? 'Time is up. Saving your answers…' : 'Saving your answers before submitting…')}
          {phase === 'sending' && (expired ? 'Time is up. Submitting your exam…' : 'Submitting your exam…')}
          {phase === 'closed' && 'This exam has ended. Loading your results…'}
        </p>
        {phase === 'saving' && !expired && (
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
        )}
      </div>
      {phase === 'unsaved' && (
        <div role="alert" className="space-y-3 rounded-lg border border-bad bg-surface p-4 text-sm">
          <p>One of your answers could not be saved. If you submit now, it will not count.</p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={saveAgain}>Try saving again</Button>
            <Button variant="secondary" onClick={submitAnyway}>
              Submit anyway
            </Button>
            <Button variant="secondary" onClick={() => setPhase(null)}>
              Keep working
            </Button>
          </div>
        </div>
      )}
      {(phase === 'failed' || phase === 'closed-failed') && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-bad bg-surface p-4 text-sm">
          <p>
            {phase === 'closed-failed'
              ? "This exam has ended. Couldn't load your results."
              : expired
                ? "Time is up. Couldn't submit your exam. The answers that were saved will be scored either way."
                : "Couldn't submit your exam. Your saved answers are safe, and you can keep working."}
          </p>
          <Button variant="secondary" onClick={() => void (phase === 'closed-failed' ? closed() : submit())}>
            Try again
          </Button>
        </div>
      )}

      {question ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
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
          <QuestionNavigator questions={questions} current={index} answered={answered} flagged={flags} onSelect={setIndex} />
        </div>
      ) : (
        <p>This exam has no questions.</p>
      )}

      {confirming && (
        <SubmitDialog
          unanswered={total - answered.size}
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
