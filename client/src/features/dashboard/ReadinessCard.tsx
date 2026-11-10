import { useId } from 'react';
import type { DashboardResponse } from '../../api/types';
import { Card } from '../../ui/Card';

/** Whether the learner looks ready for the real exam, in words, and what the server says is still missing. */
export function ReadinessCard({ readiness }: { readiness: DashboardResponse['readiness'] }) {
  const headingId = useId();
  const { ready, missing } = readiness;
  return (
    <section aria-labelledby={headingId}>
      <Card className="space-y-3">
        <h2 id={headingId} className="text-lg font-semibold">
          Exam readiness
        </h2>
        <p className={`text-2xl font-semibold ${ready ? 'text-ok' : 'text-warn'}`}>
          <span aria-hidden="true">{ready ? '✓ ' : '○ '}</span>
          {ready ? 'Ready' : 'Not yet'}
        </p>
        {ready ? (
          <p>Your recent mock exams and your mastery of every domain meet the targets.</p>
        ) : (
          missing.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm text-muted">Still missing:</p>
              <ul className="list-disc space-y-1 pl-5">
                {missing.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )
        )}
        <p className="text-sm text-muted">
          This is an estimate. Mock exam scores are estimates too: CompTIA does not publish how it scales scores.
        </p>
      </Card>
    </section>
  );
}
