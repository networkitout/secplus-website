import { useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, isUnavailable } from '../../api/client';
import type { AssessmentStarted, PathDomain, PathObjective, PathResponse } from '../../api/types';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ProgressRing } from '../../ui/ProgressRing';

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" className="inline-block shrink-0">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** A state written out in words; the icon in front of it is decoration. */
function State({ icon, tone = 'text-muted', children }: { icon?: ReactNode; tone?: string; children: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${tone}`}>
      {icon}
      <span>{children}</span>
    </span>
  );
}

const tick = <span aria-hidden="true">✓</span>;
const pending = <span aria-hidden="true">○</span>;

function ObjectiveNode({ objective, locked }: { objective: PathObjective; locked: boolean }) {
  const open = objective.published && !locked;
  const name = (
    <>
      <span className="font-mono text-muted">{objective.id}</span> <span>{objective.title}</span>
    </>
  );
  return (
    <li className="relative pl-7">
      <span
        aria-hidden="true"
        className={`absolute left-0 top-1.5 h-3 w-3 rounded-full border-2 ${
          objective.lessonDone && objective.quizPassed ? 'border-accent bg-accent' : open ? 'border-accent bg-bg' : 'border-border bg-bg'
        }`}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-medium">
            {open ? (
              <Link to={`/lesson/${encodeURIComponent(objective.id)}`} className="rounded-sm underline decoration-border underline-offset-4 hover:decoration-accent">
                {name}
              </Link>
            ) : (
              name
            )}
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            {!objective.published ? (
              <State>Coming soon</State>
            ) : locked ? (
              <State icon={<LockIcon />}>Locked</State>
            ) : (
              <>
                {objective.lessonDone ? <State icon={tick} tone="text-ok">Lesson done</State> : <State icon={pending}>Lesson not done</State>}
                {objective.quizPassed ? <State icon={tick} tone="text-ok">Quiz passed</State> : <State icon={pending}>Quiz not passed</State>}
              </>
            )}
          </p>
        </div>
        {open && <ProgressRing value={objective.mastery} size={52} label={`Mastery of objective ${objective.id}`} />}
      </div>
    </li>
  );
}

function DomainCard({ domain }: { domain: PathDomain }) {
  const headingId = useId();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const locked = !domain.unlocked;

  async function startExam() {
    // The button is not disabled meanwhile: a disabled button would drop keyboard focus.
    if (starting) return;
    setStarting(true);
    setError('');
    try {
      const { id } = await api.post<AssessmentStarted>('assessments', { kind: 'domain', scope: String(domain.id) });
      navigate(`/exam/${id}`);
    } catch (err) {
      setError(isUnavailable(err) ? "Can't reach the server. Try again in a moment." : "Couldn't start the exam. Try again.");
      setStarting(false);
    }
  }

  return (
    <li className="relative pl-8 sm:pl-10">
      <span
        aria-hidden="true"
        className={`absolute left-0 top-5 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-bg font-mono text-xs ${
          locked ? 'border-border text-muted' : 'border-accent text-accent'
        }`}
      >
        {domain.id}
      </span>
      <Card className={locked ? 'bg-transparent' : ''}>
        <section aria-labelledby={headingId} className="space-y-4">
          <div className="space-y-1">
            <h2 id={headingId} className="text-lg font-semibold">
              {`Domain ${domain.id}: ${domain.title}`}
            </h2>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-sm text-muted">{`${domain.weight}% of the exam`}</span>
              {locked && <State icon={<LockIcon />}>{`Pass the Domain ${domain.id - 1} exam to unlock`}</State>}
              {!domain.hasContent && <State>Coming soon</State>}
              {domain.examPassed && <State icon={tick} tone="text-ok">Domain exam passed</State>}
            </p>
          </div>
          <ol className="space-y-4 border-l border-border pl-0 [&>li]:-ml-1.5">
            {domain.objectives.map((o) => (
              <ObjectiveNode key={o.id} objective={o} locked={locked} />
            ))}
          </ol>
          {/* The server has no exam for a domain without published content, so none is offered. */}
          {!locked && domain.hasContent && (
            <div className="space-y-2">
              <Button variant="secondary" onClick={() => void startExam()}>
                Domain exam<span className="sr-only">{`, Domain ${domain.id}`}</span>
              </Button>
              {error && (
                <p role="alert" className="text-sm text-bad">
                  {error}
                </p>
              )}
            </div>
          )}
        </section>
      </Card>
    </li>
  );
}

export function PathPage() {
  const path = useQuery({ queryKey: ['path'], queryFn: () => api.get<PathResponse>('path') });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Study path</h1>
        <p className="text-muted">Five domains. Read each lesson, pass its quiz, then pass the domain exam to open the next domain.</p>
      </div>
      {path.data ? (
        <ol className="relative space-y-6 before:absolute before:bottom-6 before:left-3 before:top-6 before:w-px before:bg-border">
          {path.data.domains.map((d) => (
            <DomainCard key={d.id} domain={d} />
          ))}
        </ol>
      ) : path.isError ? (
        <div role="alert" className="space-y-3">
          <p>Couldn't load your study path.</p>
          <Button onClick={() => void path.refetch()}>Try again</Button>
        </div>
      ) : (
        <p role="status" className="text-muted">
          Loading your study path…
        </p>
      )}
    </div>
  );
}
