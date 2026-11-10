import type { ReactNode, RefObject } from 'react';
import { formatDay } from '../../lib/dates';
import { Button } from '../../ui/Button';
import { BOXES, count, pathLink, type ReviewedCard } from './parts';

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-mono text-xl font-semibold">{children}</dd>
    </div>
  );
}

/** What a finished round came to, and what is left for today. */
export function RoundSummary({
  headingId,
  headingRef,
  cardCount,
  total,
  nextDueOn,
  responses,
  skippedDue,
  loadingMore,
  moreError,
  onMore,
}: {
  headingId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** How many cards the round held, and how many were due when it began. */
  cardCount: number;
  total: number;
  /** The first date after today on which a card was already waiting when the round began. */
  nextDueOn: string | null;
  responses: ReviewedCard[];
  /** Cards that were skipped although the server still holds them as due today. */
  skippedDue: string[];
  loadingMore: boolean;
  moreError: string;
  onMore(): void;
}) {
  // All of this is the server's: each response gives the card's box before and after, and its next date.
  const movedUp = responses.filter((r) => r.box > r.previousBox).length;
  const backToOne = responses.filter((r) => r.box === 1).length;
  // Answered right in the last box: there is nowhere higher to go.
  const stayedOnTop = responses.length - movedUp - backToOne;
  const xp = responses.reduce((sum, r) => sum + r.xp, 0);
  // The first day a card comes back: one of this round's, or one that was already waiting.
  const nextDue = [...responses.map((r) => r.dueOn), ...(nextDueOn ? [nextDueOn] : [])].sort()[0];
  const skipped = cardCount - responses.length;
  // Still due today: what did not fit into this round, and what was skipped without the server letting go of it.
  const remaining = total - cardCount + skippedDue.filter((id) => !responses.some((r) => r.cardId === id)).length;
  return (
    <section aria-labelledby={headingId} className="space-y-5">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="rounded-sm text-xl font-semibold">
        Review complete
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Cards reviewed">{responses.length}</Stat>
        <Stat label="Moved up">{movedUp}</Stat>
        {stayedOnTop > 0 && <Stat label={`Stayed in box ${BOXES}`}>{stayedOnTop}</Stat>}
        <Stat label="Back to box 1">{backToOne}</Stat>
        {skipped > 0 && <Stat label="Skipped">{skipped}</Stat>}
        <Stat label="XP earned">{xp}</Stat>
        {nextDue && (
          <div className="col-span-2 sm:col-span-3">
            <Stat label="Next due">{formatDay(nextDue)}</Stat>
          </div>
        )}
      </dl>
      <p className="text-sm text-muted">
        {`A card you get right moves up a box (box ${BOXES} is the last) and comes back after a longer wait; the others start again in box 1.`}
        {nextDue && ' “Next due” is the first day on which a card comes back.'}
      </p>
      {remaining > 0 && (
        <div className="space-y-2">
          <p>{`${count(remaining, 'more card is', 'more cards are')} due today.`}</p>
          <Button aria-disabled={loadingMore} className="aria-disabled:cursor-progress aria-disabled:opacity-60" onClick={onMore}>
            {loadingMore ? 'Loading more cards…' : 'Review more'}
          </Button>
          <p role="status" aria-label="Loading" className="sr-only">
            {loadingMore ? 'Loading more cards…' : ''}
          </p>
          {moreError && (
            <p role="alert" className="text-sm text-bad">
              {moreError}
            </p>
          )}
        </div>
      )}
      <p>{pathLink}</p>
    </section>
  );
}
