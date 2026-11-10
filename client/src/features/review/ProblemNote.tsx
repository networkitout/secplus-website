import { useEffect, useRef } from 'react';
import { ApiError, isUnavailable } from '../../api/client';
import { Button } from '../../ui/Button';

/** What went wrong with a card, and what the learner can do about it. `stillDue`: skipping it leaves it due today. */
export type Problem = { message: string; canRetry: boolean; canSkip: boolean; stillDue: boolean };

export function problemOf(err: unknown, failed: string): Problem {
  const status = err instanceof ApiError ? err.status : 0;
  if (status === 404) return { message: 'This card is no longer available.', canRetry: false, canSkip: true, stillDue: false };
  // Not due: it was reviewed in another tab or on another device in the meantime.
  if (status === 409) {
    return { message: 'This card has already been reviewed and is not due today.', canRetry: false, canSkip: true, stillDue: false };
  }
  if (isUnavailable(err)) return { message: failed, canRetry: true, canSkip: false, stillDue: true };
  // Anything else may fail the same way every time, so there is always a way past it.
  return { message: failed, canRetry: status >= 500, canSkip: true, stillDue: true };
}

export function ProblemNote({
  problem,
  onRetry,
  onSkip,
}: {
  problem: Problem;
  onRetry?: () => void;
  onSkip(stillDue: boolean): void;
}) {
  const note = useRef<HTMLDivElement>(null);
  // Without a retry the card's own buttons are gone, and "Skip this card" is the only button here. If
  // one of the buttons that went had focus, it goes to the way forward.
  useEffect(() => {
    if (!problem.canRetry && document.activeElement === document.body) note.current?.querySelector('button')?.focus();
  }, [problem]);

  return (
    <div ref={note} role="alert" className="flex flex-wrap items-center gap-3 text-sm text-bad">
      <p>{problem.message}</p>
      {problem.canRetry && onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
      {problem.canSkip && (
        <Button variant="secondary" onClick={() => onSkip(problem.stillDue)}>
          Skip this card
        </Button>
      )}
    </div>
  );
}
