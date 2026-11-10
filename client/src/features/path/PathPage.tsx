import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, isUnavailable } from '../../api/client';
import type { AssessmentStarted, PathDomain, PathObjective, PathResponse } from '../../api/types';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
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
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const locked = !domain.unlocked;

  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function startExam() {
    // A second press while the exam is being created must not ask for another. The button is not disabled
    // meanwhile: a disabled button would drop keyboard focus.
    if (inFlight.current) return;
    inFlight.current = true;
    setStarting(true);
    setError('');
    try {
      const { id } = await api.post<AssessmentStarted>('assessments', { kind: 'domain', scope: String(domain.id) });
      // The domain now has an exam in progress: the path says "Resume" on the next visit.
      void queryClient.invalidateQueries({ queryKey: ['path'] });
      // Not if the learner has gone to another page meanwhile.
      if (mounted.current) navigate(`/exam/${id}`);
    } catch (err) {
      setError(isUnavailable(err) ? "Can't reach the server. Try again in a moment." : "Couldn't start the exam. Try again.");
      inFlight.current = false;
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
              <div className="flex flex-wrap items-center gap-3">
                {domain.openExam ? (
                  <Button variant="secondary" onClick={() => navigate(`/exam/${domain.openExam!.id}`)}>
                    Resume domain exam<span className="sr-only">{`, Domain ${domain.id}`}</span>
                  </Button>
                ) : (
                  // Starting an exam starts its clock, so the learner is asked first. Nothing happens while
                  // one is being created.
                  <Button variant="secondary" aria-busy={starting} onClick={() => !inFlight.current && setConfirming(true)}>
                    Domain exam<span className="sr-only">{`, Domain ${domain.id}`}</span>
                  </Button>
                )}
                <p role="status" className="text-sm text-muted">
                  {starting ? 'Starting the exam…' : ''}
                </p>
              </div>
              {domain.openExam && <p className="text-sm text-muted">You have an exam in progress. Its clock is running.</p>}
              {error && (
                <p role="alert" className="text-sm text-bad">
                  {error}
                </p>
              )}
            </div>
          )}
          {confirming && (
            <ConfirmDialog
              title={`Start the Domain ${domain.id} exam?`}
              confirmLabel="Start exam"
              onCancel={() => setConfirming(false)}
              onConfirm={() => {
                setConfirming(false);
                void startExam();
              }}
            >
              <p>Up to 25 questions from this domain, with 25 minutes to answer them. You need 75% to pass.</p>
              <p className="text-sm text-muted">
                There is no feedback until the end: the answers and explanations are shown after you submit. The clock starts
                when you start the exam and keeps running if you leave the page.
              </p>
            </ConfirmDialog>
          )}
        </section>
      </Card>
    </li>
  );
}

export function PathPage() {
  const path = useQuery({ queryKey: ['path'], queryFn: () => api.get<PathResponse>('path') });
  // The query forgets a failure as soon as it fetches again; remember the retry, so that "Try again" stays
  // where it is (and keeps keyboard focus) until the answer arrives.
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    void path.refetch().finally(() => setRetrying(false));
  };

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
      ) : path.isError || retrying ? (
        <div className="space-y-3">
          {path.isError && <p role="alert">Couldn't load your study path.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button aria-busy={retrying} onClick={retry}>
              Try again
            </Button>
            <p role="status" className="text-sm text-muted">
              {retrying ? 'Loading your study path…' : ''}
            </p>
          </div>
        </div>
      ) : (
        <p role="status" className="text-muted">
          Loading your study path…
        </p>
      )}
    </div>
  );
}
