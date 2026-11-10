import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { LabsResponse, LabSummary, PathDomain, PathResponse } from '../../api/types';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { wholePercent } from './percent';

const LINK = 'rounded-sm underline decoration-border underline-offset-4 hover:decoration-accent';

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" className="inline-block shrink-0">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** A state in words, with a decorative mark in front of it. */
function State({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 text-sm ${ok ? 'text-ok' : 'text-muted'}`}>
      <span aria-hidden="true">{ok ? '✓' : '○'}</span>
      <span>{children}</span>
    </span>
  );
}

/** Why a lab is closed: its domain is locked, or lessons it builds on are not finished. `domain` is unknown while the path cannot be read. */
function Requirements({ lab, domain }: { lab: LabSummary; domain?: PathDomain }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="inline-flex items-center gap-1.5 text-muted">
        <LockIcon />
        <span>Locked</span>
      </p>
      {domain && !domain.unlocked && <p>{`Pass the Domain ${domain.id - 1} exam to unlock Domain ${domain.id}.`}</p>}
      <p>Finish these lessons to open this lab:</p>
      {/* role="list" keeps the list semantics that Safari drops when list markers are removed. */}
      <ul role="list" className="space-y-1">
        {lab.objectives.map((id) => {
          const objective = domain?.objectives.find((o) => o.id === id);
          if (!objective) return <li key={id}>{`Lesson ${id}`}</li>;
          const name = `${objective.id} ${objective.title}`;
          return (
            <li key={id} className="flex flex-wrap items-baseline gap-x-3">
              {domain?.unlocked && objective.published ? (
                <Link to={`/lesson/${encodeURIComponent(id)}`} className={LINK}>
                  {name}
                </Link>
              ) : (
                <span>{name}</span>
              )}
              <State ok={objective.lessonDone}>{objective.lessonDone ? 'Lesson done' : 'Lesson not done'}</State>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LabCard({ lab, domain }: { lab: LabSummary; domain?: PathDomain }) {
  return (
    <li>
      <Card className={`space-y-2 ${lab.available ? '' : 'bg-transparent'}`}>
        <h3 className="text-lg font-semibold">
          {lab.available ? (
            <Link to={`/labs/${encodeURIComponent(lab.id)}`} className={LINK}>
              {lab.title}
            </Link>
          ) : (
            lab.title
          )}
        </h3>
        <p className="font-mono text-sm text-muted">{`${lab.objectives.length === 1 ? 'Objective' : 'Objectives'} ${lab.objectives.join(', ')}`}</p>
        {lab.bestScore !== null ? (
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-mono text-sm">{`Best score: ${wholePercent(lab.bestScore)}%`}</span>
            <State ok={lab.passed}>{lab.passed ? 'Passed' : 'Not passed yet'}</State>
          </p>
        ) : (
          lab.available && <p className="text-sm text-muted">Not attempted yet</p>
        )}
        {!lab.available && <Requirements lab={lab} domain={domain} />}
      </Card>
    </li>
  );
}

function DomainSection({ id, labs, domain }: { id: number; labs: LabSummary[]; domain?: PathDomain }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {domain ? `Domain ${id}: ${domain.title}` : `Domain ${id}`}
      </h2>
      <ul role="list" className="grid gap-4 sm:grid-cols-2">
        {labs.map((lab) => (
          <LabCard key={lab.id} lab={lab} domain={domain} />
        ))}
      </ul>
    </section>
  );
}

export function LabsPage() {
  const labs = useQuery({ queryKey: ['labs'], queryFn: () => api.get<LabsResponse>('labs') });
  // Titles and lesson states for the cards. Optional: without the path a locked lab names its lessons by number.
  const path = useQuery({ queryKey: ['path'], queryFn: () => api.get<PathResponse>('path'), throwOnError: false });

  const domains = [...new Set(labs.data?.labs.map((lab) => lab.domain))].sort((a, b) => a - b);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Labs</h1>
        <p className="text-muted">Each lab is one scenario worked through in several steps. Score 80% or more to pass it.</p>
      </div>
      {labs.data ? (
        domains.length === 0 ? (
          <p>There are no labs yet.</p>
        ) : (
          domains.map((id) => (
            <DomainSection
              key={id}
              id={id}
              labs={labs.data.labs.filter((lab) => lab.domain === id)}
              domain={path.data?.domains.find((d) => d.id === id)}
            />
          ))
        )
      ) : labs.isError ? (
        <div role="alert" className="space-y-3">
          <p>Couldn't load the labs.</p>
          <Button onClick={() => void labs.refetch()}>Try again</Button>
        </div>
      ) : (
        <p role="status" className="text-muted">
          Loading labs…
        </p>
      )}
    </div>
  );
}
