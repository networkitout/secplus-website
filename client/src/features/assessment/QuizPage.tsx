import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import type { Answer, Feedback } from '../../../../shared/types';
import { api, ApiError, isUnavailable } from '../../api/client';
import type { AnswerSaveResponse, AssessmentResult, AssessmentStarted, AssessmentView, SubmitResponse } from '../../api/types';
import { Button } from '../../ui/Button';
import { initialAnswer, isComplete, QuestionView } from '../questions/QuestionView';
import { LoadState, pathLink } from './LoadState';
import { ResultsView } from './ResultsView';
import { useAssessment } from './useAssessment';

export function QuizPage() {
  const { id = '' } = useParams();
  return <Quiz key={id} id={id} />;
}

function Quiz({ id }: { id: string }) {
  const { query, reload, finishedHere } = useAssessment(id);
  const view = query.data;
  if (!view) return <LoadState query={query} noun="quiz" />;
  if (view.kind !== 'objective') return <Navigate to={`/exam/${view.id}`} replace />;
  if (view.result) return <QuizResults view={view} result={view.result} fresh={finishedHere} />;
  return <QuizRunner view={view} reload={reload} />;
}

/** A question that the server has marked: the answer it holds and its feedback. */
type Marked = { answer: Answer; feedback: Feedback };

function markedIn(view: AssessmentView): Record<string, Marked> {
  const out: Record<string, Marked> = {};
  for (const [questionId, answer] of Object.entries(view.answers)) {
    const feedback = view.feedback[questionId];
    if (feedback) out[questionId] = { answer, feedback };
  }
  return out;
}

function QuizRunner({ view, reload }: { view: AssessmentView; reload(): Promise<AssessmentView> }) {
  const { questions } = view;
  const total = questions.length;
  const answersUrl = `assessments/${view.id}/answers`;

  const [marked, setMarked] = useState(() => markedIn(view));
  // Resumes at the first question without an answer; when all have one, at the last, ready for the results.
  const [index, setIndex] = useState(() => {
    const first = questions.findIndex((q) => !view.answers[q.id]);
    return first === -1 ? Math.max(0, total - 1) : first;
  });
  const [value, setValue] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Set and read in the same tick, which state is not: two clicks in a row must not send twice.
  const sending = useRef(false);

  const heading = useRef<HTMLHeadingElement>(null);
  const container = useRef<HTMLElement>(null);
  const headingId = useId();

  // On a new question, focus goes to its heading: the button that was pressed now means something else.
  const shown = useRef(index);
  useEffect(() => {
    if (shown.current === index) return;
    shown.current = index;
    heading.current?.focus();
  }, [index]);

  const question = questions[index];
  if (!question) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">{`Objective ${view.scope} quiz`}</h1>
        <p>This quiz has no questions.</p>
        <p>{pathLink}</p>
      </div>
    );
  }
  const done = marked[question.id];
  const last = index === total - 1;
  const answeredCount = questions.filter((q) => marked[q.id]).length;

  async function exclusively(action: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  /** The server says this question has an answer already, or the quiz is finished: show what it holds. */
  async function showWhatTheServerHas(questionId: string) {
    const fresh = await reload();
    if (fresh.result) return; // the page has moved on to the results
    setMarked(markedIn(fresh));
    if (!fresh.answers[questionId]) throw new Error('Rejected, but not answered');
  }

  const check = () =>
    exclusively(async () => {
      const answer = value ?? initialAnswer(question);
      if (!answer || done) return;
      try {
        const res = await api.put<AnswerSaveResponse>(answersUrl, { questionId: question.id, answer });
        if (!('feedback' in res)) throw new Error('The answer was stored but not marked');
        setMarked((m) => ({ ...m, [question.id]: { answer, feedback: res.feedback } }));
        setError('');
      } catch (err) {
        try {
          if (!(err instanceof ApiError && err.status === 409)) throw err;
          await showWhatTheServerHas(question.id);
          setError('');
        } catch (failure) {
          setError(
            isUnavailable(failure)
              ? "Couldn't send your answer. It has not been marked yet."
              : "Couldn't check your answer. Try again.",
          );
          return;
        }
      }
      // The Check button gives way to Next: keep keyboard focus by the question and its result.
      if (container.current?.contains(document.activeElement)) container.current.focus();
    });

  function next(e: MouseEvent) {
    // The second click of a double click on Check can land here, once the button has changed.
    if (e.detail > 1) return;
    setValue(null);
    setError('');
    setIndex(index + 1);
  }

  const finish = () =>
    exclusively(async () => {
      try {
        await api.post<SubmitResponse>(`assessments/${view.id}/submit`);
        await reload(); // the page now shows the results
      } catch (err) {
        setError(isUnavailable(err) ? "Can't reach the server. Try again in a moment." : "Couldn't finish the quiz. Try again.");
      }
    });

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">{`Objective ${view.scope} quiz`}</h1>
        <div
          role="progressbar"
          aria-label="Quiz progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={answeredCount}
          aria-valuetext={`${answeredCount} of ${total} answered`}
          className="h-2 overflow-hidden rounded-full bg-border"
        >
          <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${(answeredCount / total) * 100}%` }} />
        </div>
      </header>

      <section ref={container} tabIndex={-1} aria-labelledby={headingId} className="space-y-4">
        <h2 id={headingId} ref={heading} tabIndex={-1} className="font-mono text-sm uppercase tracking-wide text-accent">
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
        {error && (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          {!done ? (
            <Button disabled={!isComplete(question, value)} onClick={() => void check()}>
              {error ? 'Try again' : 'Check'}
            </Button>
          ) : last ? (
            <Button onClick={() => void finish()}>See results</Button>
          ) : (
            <Button onClick={next}>Next</Button>
          )}
        </div>
      </section>
    </article>
  );
}

function QuizResults({ view, result, fresh }: { view: AssessmentView; result: AssessmentResult; fresh: boolean }) {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const starting = useRef(false);

  async function retake() {
    // The button is not disabled meanwhile: a disabled button would drop keyboard focus.
    if (starting.current) return;
    starting.current = true;
    setError('');
    try {
      const { id } = await api.post<AssessmentStarted>('assessments', { kind: 'objective', scope: view.scope });
      navigate(`/quiz/${id}`);
    } catch (err) {
      setError(isUnavailable(err) ? "Can't reach the server. Try again in a moment." : "Couldn't start the quiz. Try again.");
      starting.current = false;
    }
  }

  return (
    <ResultsView
      title={`Objective ${view.scope} quiz results`}
      passTitle={`Objective ${view.scope}`}
      kind="objective"
      result={result}
      questions={view.questions}
      answers={view.answers}
      feedback={view.feedback}
      fresh={fresh}
    >
      <Button variant={result.passed ? 'secondary' : 'primary'} onClick={() => void retake()}>
        Retake
      </Button>
      {pathLink}
      {error && (
        <p role="alert" className="basis-full text-sm text-bad">
          {error}
        </p>
      )}
    </ResultsView>
  );
}
