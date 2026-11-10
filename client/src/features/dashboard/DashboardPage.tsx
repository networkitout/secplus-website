import { useQuery } from '@tanstack/react-query';
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { DashboardResponse } from '../../api/types';
import { Card } from '../../ui/Card';
import { formatCalendarDate } from '../../lib/dates';
import { MasteryBar } from '../../ui/MasteryBar';
import { QueryStatus } from '../../ui/QueryStatus';
import { useAuth } from '../auth/AuthProvider';
import { BadgeGrid } from './BadgeGrid';
import { MockHistoryChart } from './MockHistoryChart';
import { ReadinessCard } from './ReadinessCard';

const LINK = 'text-accent underline underline-offset-2';
const BUTTON_LINK = 'inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:opacity-90';
const SECONDARY_BUTTON_LINK =
  'inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-text hover:border-accent';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <Card className="space-y-4">
        <h2 id={headingId} className="text-lg font-semibold">
          {title}
        </h2>
        {children}
      </Card>
    </section>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-bg p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-mono text-xl font-semibold">{children}</dd>
    </div>
  );
}

function StudyPlan({ plan, examDate }: { plan: NonNullable<DashboardResponse['studyPlan']>; examDate: string | null }) {
  return (
    <Section title="Study plan">
      {plan.daysLeft < 0 ? (
        <p>
          {'Your exam date has passed — update it in '}
          <Link to="/settings" className={LINK}>
            Settings
          </Link>
          .
        </p>
      ) : (
        <p>{plan.message}</p>
      )}
      {examDate && (
        <p className="text-sm text-muted">
          {'Exam date: '}
          <time dateTime={examDate}>{formatCalendarDate(examDate)}</time>
        </p>
      )}
    </Section>
  );
}

function Dashboard({ data }: { data: DashboardResponse }) {
  const { user } = useAuth();
  const timeZone = user?.timeZone ?? 'UTC';
  const earned = data.badges.filter((b) => b.earnedAt !== null).length;

  return (
    <>
      <Section title="Your progress">
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-3">
          <Stat label="Level">{data.level}</Stat>
          <Stat label="XP">{data.xp}</Stat>
          <Stat label="Streak">{count(data.streak, 'day', 'days')}</Stat>
        </dl>
        <p className="text-sm text-muted">{`${Math.max(0, data.nextLevelXp - data.xp)} XP to level ${data.level + 1}`}</p>
      </Section>

      <ReadinessCard readiness={data.readiness} />

      {data.studyPlan && <StudyPlan plan={data.studyPlan} examDate={user?.examDate ?? null} />}

      <Section title="Reviews">
        {data.reviewsDue > 0 ? (
          <div className="flex flex-wrap items-center gap-4">
            <p>{`${count(data.reviewsDue, 'card is', 'cards are')} due today.`}</p>
            <Link to="/review" className={BUTTON_LINK}>
              Start review
            </Link>
          </div>
        ) : (
          <p>No reviews due today.</p>
        )}
      </Section>

      <Section title="Mastery by domain">
        <div className="space-y-4">
          {data.domains.map((d) => (
            <MasteryBar key={d.id} value={d.mastery} label={`Domain ${d.id}: ${d.title}`} />
          ))}
        </div>
      </Section>

      <Section title="Weakest objectives">
        {data.weakest.length === 0 ? (
          <p className="text-muted">Answer some questions, and the objectives that need the most work appear here.</p>
        ) : (
          <ul role="list" className="space-y-4">
            {data.weakest.map((o) => (
              <li key={o.objective} className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1 basis-56">
                  <MasteryBar value={o.mastery} label={`${o.objective} ${o.title}`} />
                </div>
                <Link to={`/practice/${encodeURIComponent(o.objective)}`} className={SECONDARY_BUTTON_LINK}>
                  Practice now
                  <span className="sr-only">{`: objective ${o.objective}`}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Practice exam history">
        <p className="text-sm text-muted">Scores are estimates on a scale from 100 to 900: CompTIA does not publish how it scales scores.</p>
        {data.mockHistory.length === 0 ? (
          <p>
            {'No practice exams yet. '}
            <Link to="/exam" className={LINK}>
              Go to the exam page
            </Link>
          </p>
        ) : (
          <MockHistoryChart mocks={data.mockHistory} timeZone={timeZone} />
        )}
      </Section>

      <Section title="Badges">
        <p className="text-sm text-muted">{`${earned} of ${data.badges.length} earned`}</p>
        <BadgeGrid badges={data.badges} timeZone={timeZone} />
      </Section>
    </>
  );
}

export function DashboardPage() {
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardResponse>('dashboard') });
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <QueryStatus query={dashboard} what="your dashboard" />
      {dashboard.data && <Dashboard data={dashboard.data} />}
    </div>
  );
}
