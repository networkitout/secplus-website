import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { Answer, Feedback, PublicQuestion } from '../../../../shared/types';
import { api, ApiError, isUnavailable } from '../../api/client';
import type { AnswerResponse, PracticeResponse } from '../../api/types';
import { Button } from '../../ui/Button';
import { initialAnswer, isComplete, QuestionView } from '../questions/QuestionView';
import { useRewards } from '../rewards/RewardsProvider';

const LINK = 'text-accent underline underline-offset-2';

const wayBack = (
  <p className="flex flex-wrap gap-x-6 gap-y-2">
    <Link to="/dashboard" className={LINK}>
      Back to dashboard
    </Link>
    <Link to="/" className={LINK}>
      Back to path
    </Link>
  </p>
);

/** A question that the server has marked: the answer it was sent, what it said, and the XP it gave. */
type Marked = { answer: Answer; feedback: Feedback; xp: number };

/** Why an answer was not marked. Only a failure that may pass (no connection, a server fault) is worth another try. */
type Problem = { message: string; canRetry: boolean };

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-mono text-xl font-semibold">{children}</dd>
    </div>
  );
}

/** One practice session: the questions it began with, one at a time, then a summary. */
function PracticeSession({ questions }: { questions: PublicQuestion[] }) {
  const queryClient = useQueryClient();
  const { report } = useRewards();
  const total = questions.length;
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState<Answer | null>(null);
  const [marked, setMarked] = useState<Record<string, Marked>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  // Ids of the questions whose answer is on its way or has been marked. Set and read in the same tick, which
  // state is not: two presses in a row must not send twice.
  const sent = useRef(new Set<string>());
  // An answer was marked since the dashboard and the path last read their numbers.
  const stale = useRef(false);

  const heading = useRef<HTMLHeadingElement>(null);
  const container = useRef<HTMLElement>(null);
  const headingId = useId();

  const question = questions[index];
  const finished = index >= total;

  // On a new question (or the summary), focus goes to its heading: the button that was pressed is gone.
  const shown = useRef(index);
  useEffect(() => {
    if (shown.current === index) return;
    shown.current = index;
    heading.current?.focus();
  }, [index]);

  // Mastery changes with every marked answer, whether or not it earned XP. At the end, and when the session
  // is left half way, the dashboard and the path read their numbers again.
  useEffect(() => {
    function refresh() {
      if (!stale.current) return;
      stale.current = false;
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['path'] });
    }
    if (finished) refresh();
    return refresh;
  }, [finished, queryClient]);

  if (!question) {
    const results = Object.values(marked);
    const correct = results.filter((r) => r.feedback.correct).length;
    const xp = results.reduce((sum, r) => sum + r.xp, 0);
    const skipped = total - results.length;
    return (
      <section aria-labelledby={headingId} className="space-y-5">
        <h2 id={headingId} ref={heading} tabIndex={-1} className="rounded-sm text-xl font-semibold">
          Practice complete
        </h2>
        <p>{`${correct} of ${results.length} correct`}</p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Questions answered">{results.length}</Stat>
          <Stat label="XP earned">{xp}</Stat>
        </dl>
        {skipped > 0 && <p className="text-sm text-muted">{`${skipped} ${skipped === 1 ? 'question' : 'questions'} skipped`}</p>}
        <p className="text-sm text-muted">Questions you got wrong come back first the next time you practice this objective.</p>
        {wayBack}
      </section>
    );
  }

  const done = marked[question.id];
  const last = index === total - 1;

  async function check() {
    const q = question;
    if (!q) return;
    const answer = value ?? initialAnswer(q);
    if (!answer || sent.current.has(q.id)) return;
    sent.current.add(q.id);
    setBusy(true);
    try {
      const { feedback, xp, newBadges } = await api.post<AnswerResponse>('answers', { questionId: q.id, answer });
      stale.current = true;
      setProblem(null);
      setMarked((m) => ({ ...m, [q.id]: { answer, feedback, xp } }));
      report({ xp, newBadges });
      // Check gives way to Next: keep keyboard focus by the question and its result.
      if (container.current?.contains(document.activeElement)) container.current.focus();
    } catch (err) {
      sent.current.delete(q.id);
      const status = err instanceof ApiError ? err.status : 0;
      if (isUnavailable(err)) setProblem({ message: "Couldn't send your answer. It has not been marked yet.", canRetry: true });
      else if (status >= 500) setProblem({ message: "Couldn't check your answer. Try again.", canRetry: true });
      // Rejected by the server (for example a question that was removed): another try would fail the same way.
      else setProblem({ message: "This question can't be marked.", canRetry: false });
    } finally {
      setBusy(false);
    }
  }

  function next(e: MouseEvent) {
    // The second click of a double click on Check can land here, once the button has changed.
    if (e.detail > 1) return;
    setValue(null);
    setProblem(null);
    setIndex(index + 1);
  }

  return (
    <div className="space-y-4">
      <div
        role="progressbar"
        aria-label="Practice progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={index}
        aria-valuetext={`${index} of ${total} done`}
        className="h-2 overflow-hidden rounded-full bg-border"
      >
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${(index / total) * 100}%` }} />
      </div>
      <section ref={container} tabIndex={-1} aria-labelledby={headingId} className="space-y-4 rounded-sm">
        <h2 id={headingId} ref={heading} tabIndex={-1} className="rounded-sm font-mono text-sm uppercase tracking-wide text-accent">
          {`Question ${index + 1} of ${total}`}
        </h2>
        <QuestionView
          key={question.id}
          question={question}
          value={done ? done.answer : value}
          onChange={setValue}
          feedback={done?.feedback}
          disabled={busy}
        />
        {problem && (
          <p role="alert" className="text-sm text-bad">
            {problem.message}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          {done ? (
            <Button onClick={next}>{last ? 'Finish' : 'Next'}</Button>
          ) : problem && !problem.canRetry ? (
            <Button variant="secondary" onClick={next}>
              Skip this question
            </Button>
          ) : (
            <Button disabled={!isComplete(question, value)} aria-busy={busy || undefined} onClick={() => void check()}>
              {busy ? 'Checking…' : problem ? 'Try again' : 'Check'}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

function PracticeLoader({ objective }: { objective: string }) {
  // Read from the server on every visit, and never again during it: what comes back depends on the answers
  // given so far, and a session keeps the questions it began with.
  const practice = useQuery({
    queryKey: ['practice', objective],
    queryFn: () => api.get<PracticeResponse>(`practice/${encodeURIComponent(objective)}`),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnMount: 'always',
  });
  const box = useRef<HTMLDivElement>(null);
  const retried = useRef(false);
  const loaded = practice.data !== undefined;

  // "Try again" worked and its button is gone: focus stays here instead of falling back to the document.
  useEffect(() => {
    if (loaded && retried.current && document.activeElement === document.body) box.current?.focus();
  }, [loaded]);

  function retry() {
    retried.current = true;
    void practice.refetch();
  }

  function content() {
    if (practice.data) {
      if (practice.data.questions.length === 0) {
        return (
          <div className="space-y-4">
            <p className="text-lg font-medium">Nothing to practice here — mastery is 100%</p>
            <p className="text-muted">Every question of this objective was answered correctly the last time you saw it.</p>
            {wayBack}
          </div>
        );
      }
      // A new answer from the server is a new session.
      return <PracticeSession key={practice.dataUpdatedAt} questions={practice.data.questions} />;
    }
    if (!practice.isError) {
      return (
        <p role="status" className="text-muted">
          Loading the practice questions…
        </p>
      );
    }
    const status = practice.error instanceof ApiError ? practice.error.status : 0;
    return (
      <div className="space-y-4">
        {status === 403 ? (
          // The server's message says how the domain is unlocked.
          <p role="alert">{`This objective is locked. ${practice.error.message}.`}</p>
        ) : status === 404 ? (
          // Unknown, or without content yet.
          <p role="alert">{`Objective ${objective} is not available to practice.`}</p>
        ) : (
          <>
            <p role="alert">Couldn't load the practice questions.</p>
            <Button aria-busy={practice.isFetching || undefined} onClick={retry}>
              {practice.isFetching ? 'Trying again…' : 'Try again'}
            </Button>
          </>
        )}
        {wayBack}
      </div>
    );
  }

  return (
    <div ref={box} tabIndex={-1} className="rounded-sm">
      {content()}
    </div>
  );
}

export function PracticePage() {
  const { objective = '' } = useParams();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{`Practice: objective ${objective}`}</h1>
      <PracticeLoader key={objective} objective={objective} />
    </div>
  );
}
