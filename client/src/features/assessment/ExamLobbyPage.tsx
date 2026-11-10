import { useQuery } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, isUnavailable } from '../../api/client';
import type { AssessmentStarted, DashboardMocks, DashboardSummary, MockHistoryEntry, PathResponse } from '../../api/types';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';

const FULL_EXAM = '90 questions in 90 minutes';

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** "Domain 1", "Domains 1 and 2", "Domains 1, 2 and 4". */
function domainList(ids: number[]): string {
  if (ids.length === 1) return `Domain ${ids[0]}`;
  return `Domains ${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
}

function HistoryRow({ exam }: { exam: MockHistoryEntry }) {
  const date = when.format(new Date(exam.submittedAt));
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
      <time dateTime={exam.submittedAt} className="basis-full text-sm text-muted sm:basis-48">
        {date}
      </time>
      <span className="font-mono">
        <span className="sr-only">Estimated scaled score: </span>
        {exam.scaledScore}
      </span>
      <span className={`text-sm font-semibold ${exam.passed ? 'text-ok' : 'text-warn'}`}>
        <span aria-hidden="true">{exam.passed ? '✓ ' : '○ '}</span>
        {exam.passed ? 'Passed' : 'Not yet'}
      </span>
      {exam.partial && <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted">Partial</span>}
      <Link to={`/exam/${exam.id}`} className="ml-auto text-sm text-accent underline underline-offset-2">
        Review<span className="sr-only">{` the exam of ${date}`}</span>
      </Link>
    </li>
  );
}

export function ExamLobbyPage() {
  const navigate = useNavigate();
  const path = useQuery({ queryKey: ['path'], queryFn: () => api.get<PathResponse>('path') });
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardSummary & DashboardMocks>('dashboard'),
  });
  const [error, setError] = useState('');
  const starting = useRef(false);
  const historyId = useId();

  // Oldest first from the server; the newest is the most useful one to see first.
  const history = dashboard.data ? [...dashboard.data.mockHistory].reverse() : undefined;
  // A mock draws on every domain that has published content. The path says which do; when it cannot be
  // read, the latest practice exam says whether exams are still partial.
  const domains = path.data?.domains;
  const covered = domains?.filter((d) => d.hasContent).map((d) => d.id) ?? [];
  const nothingPublished = domains !== undefined && covered.length === 0;
  const partial = domains
    ? covered.length > 0 && covered.length < domains.length
    : path.isError && history?.[0]?.partial === true;
  const lengthKnown = path.data !== undefined || path.isError;

  async function start() {
    // The button is not disabled meanwhile: a disabled button would drop keyboard focus.
    if (starting.current) return;
    starting.current = true;
    setError('');
    try {
      const { id } = await api.post<AssessmentStarted>('assessments', { kind: 'mock' });
      navigate(`/exam/${id}`);
    } catch (err) {
      setError(isUnavailable(err) ? "Can't reach the server. Try again in a moment." : "Couldn't start the exam. Try again.");
      starting.current = false;
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Practice exam</h1>
        <p className="text-muted">A timed mock of the Security+ exam, drawn from every domain that has published lessons.</p>
      </div>

      {partial && (
        <div className="rounded-lg border border-warn bg-surface p-5">
          <p className="font-semibold">
            <span aria-hidden="true">⚠ </span>
            {covered.length > 0
              ? `Partial practice exam — covers ${domainList(covered)} only`
              : 'Partial practice exam — it does not cover all five domains yet'}
          </p>
          <p className="mt-1 text-sm text-muted">
            It is shorter than the full exam, and its score says less than a full exam would.
          </p>
        </div>
      )}

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">How it works</h2>
        <ul aria-label="Exam rules" className="list-disc space-y-2 pl-5">
          <li>
            {!lengthKnown
              ? 'One minute per question.'
              : partial
                ? `The full exam has ${FULL_EXAM}. A partial exam is shorter and keeps the same pace: one minute per question.`
                : `${FULL_EXAM}: one minute per question.`}
          </li>
          <li>No feedback until the end. After you submit you see every answer with its explanation.</li>
          <li>The score is on a scale from 100 to 900. You need 750 to pass. It is an estimate: CompTIA does not publish its scaling.</li>
          <li>You can flag questions and come back to them before you submit.</li>
          <li>
            Your answers are saved as you go. The clock keeps running if you leave, and the exam is submitted for you when
            the time is up.
          </li>
        </ul>
        {nothingPublished ? (
          <p>Practice exams open once the first lessons are published.</p>
        ) : (
          <div className="space-y-2">
            <Button onClick={() => void start()}>Start practice exam</Button>
            <p className="text-sm text-muted">If you have a practice exam in progress, this takes you back to it.</p>
            {error && (
              <p role="alert" className="text-sm text-bad">
                {error}
              </p>
            )}
          </div>
        )}
      </Card>

      <section aria-labelledby={historyId} className="space-y-2">
        <h2 id={historyId} className="text-lg font-semibold">
          Your practice exams
        </h2>
        {history === undefined ? (
          dashboard.isError ? (
            <p role="alert">Couldn't load your practice exams.</p>
          ) : (
            <p role="status" className="text-muted">
              Loading your practice exams…
            </p>
          )
        ) : history.length === 0 ? (
          <p className="text-muted">No practice exams yet.</p>
        ) : (
          // role="list" keeps the list semantics that Safari drops when list markers are removed.
          <ul role="list" aria-labelledby={historyId} className="divide-y divide-border">
            {history.map((exam) => (
              <HistoryRow key={exam.id} exam={exam} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
