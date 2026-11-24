import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { api, isUnavailable } from '../../api/client';
import type { ReviewCard, ReviewDueResponse, ReviewResponse } from '../../api/types';
import { formatDay } from '../../lib/dates';
import { Button } from '../../ui/Button';
import { useRewards } from '../rewards/RewardsProvider';
import { FlashcardCard } from './FlashcardCard';
import { count, pathLink, type ReviewedCard } from './parts';
import { QuestionCard } from './QuestionCard';
import { RoundSummary } from './RoundSummary';

/** One round: the due cards as they were when it began, one at a time, then the summary. */
function ReviewRound({
  due,
  focusFirst,
  more,
}: {
  due: ReviewDueResponse;
  /** The round follows another one on the same visit: its first card takes focus. */
  focusFirst: boolean;
  /** Loads the next round; resolves to a message when that failed. */
  more(): Promise<string>;
}) {
  const queryClient = useQueryClient();
  const { report } = useRewards();
  // The round keeps the cards it began with, whatever the query holds later.
  const [{ cards, total, nextDueOn }] = useState(due);
  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState<ReviewedCard[]>([]);
  // Cards that were skipped although the server still holds them as due today.
  const [skippedDue, setSkippedDue] = useState<string[]>([]);
  const [moreError, setMoreError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const section = useRef<HTMLElement>(null);
  // Set and read in the same tick, which state is not: two presses in a row must not load twice.
  const loading = useRef(false);
  // Something was reviewed since the path last read its numbers.
  const stale = useRef(false);

  const card = cards[index];
  const finished = index >= cards.length;

  // On a new card (or the summary), focus goes to its heading: the button that was pressed is gone.
  const shown = useRef(focusFirst ? -1 : 0);
  useEffect(() => {
    if (shown.current === index) return;
    shown.current = index;
    heading.current?.focus();
  }, [index]);

  // After a round, and when a round is left half way, the path reads its numbers again.
  useEffect(() => {
    function refresh() {
      if (!stale.current) return;
      stale.current = false;
      void queryClient.invalidateQueries({ queryKey: ['path'] });
    }
    if (finished) refresh();
    return refresh;
  }, [finished, queryClient]);

  /**
   * Every review response arrives here, once: also a late one, from a card the round has left. What it
   * earned goes to the rewards provider, which reads the header's totals again (it outlives this round, so
   * a response that arrives after the learner has left the page is still reported).
   */
  function reviewed(done: ReviewCard, res: ReviewResponse) {
    setResponses((all) => (all.some((r) => r.cardId === done.cardId) ? all : [...all, { ...res, cardId: done.cardId }]));
    stale.current = true;
    report({ xp: res.xp, newBadges: res.newBadges });
  }

  async function loadMore() {
    if (loading.current) return;
    loading.current = true;
    setLoadingMore(true);
    setMoreError('');
    const failure = await more();
    // Without a failure a new round has taken this one's place.
    loading.current = false;
    setLoadingMore(false);
    setMoreError(failure);
  }

  if (cards.length === 0) {
    return (
      <div className="space-y-3">
        <h2 ref={heading} tabIndex={-1} className="rounded-sm text-lg font-medium">
          {nextDueOn ? `Nothing due today. Next review: ${formatDay(nextDueOn)}.` : 'Nothing due today.'}
        </h2>
        <p className="text-muted">
          Cards come back here on the day they are due: the flashcards of each lesson you finish, and every question you miss.
        </p>
        <p>{pathLink}</p>
      </div>
    );
  }

  if (!card) {
    return (
      <RoundSummary
        headingId={headingId}
        headingRef={heading}
        cardCount={cards.length}
        total={total}
        nextDueOn={nextDueOn}
        responses={responses}
        skippedDue={skippedDue}
        loadingMore={loadingMore}
        moreError={moreError}
        onMore={() => void loadMore()}
      />
    );
  }

  // Only from the card that is shown: a late call from a card the round has left changes nothing.
  const next = () => setIndex((now) => (now === index ? index + 1 : now));
  const skip = (stillDue: boolean) => {
    if (stillDue) setSkippedDue((ids) => (ids.includes(card.cardId) ? ids : [...ids, card.cardId]));
    next();
  };
  return (
    <section ref={section} aria-labelledby={headingId} className="space-y-4">
      <div className="space-y-2">
        <div
          role="progressbar"
          aria-label="Review progress"
          aria-valuemin={0}
          aria-valuemax={cards.length}
          aria-valuenow={index}
          aria-valuetext={`${index} of ${count(cards.length, 'card', 'cards')} done`}
          className="h-2 overflow-hidden rounded-full bg-border"
        >
          <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${(index / cards.length) * 100}%` }} />
        </div>
        {total > cards.length && (
          <p className="text-sm text-muted">{`${count(total, 'card is', 'cards are')} due today. This round has ${cards.length}.`}</p>
        )}
      </div>
      <h2 id={headingId} ref={heading} tabIndex={-1} className="rounded-sm font-mono text-sm uppercase tracking-wide text-accent">
        {`Card ${index + 1} of ${cards.length}: ${card.kind}`}
      </h2>
      {card.kind === 'flashcard' ? (
        <FlashcardCard key={card.cardId} card={card} scope={section} onReviewed={reviewed} onNext={next} onSkip={skip} />
      ) : (
        <QuestionCard key={card.cardId} card={card} last={index === cards.length - 1} onReviewed={reviewed} onNext={next} onSkip={skip} />
      )}
    </section>
  );
}

export function ReviewPage() {
  // Always read from the server: what is due changes with the day and with reviews on any device.
  const due = useQuery({
    queryKey: ['review', 'due'],
    queryFn: () => api.get<ReviewDueResponse>('review/due'),
    staleTime: Infinity,
    gcTime: 0,
  });
  const { refetch } = due;
  const [round, setRound] = useState(0);

  async function more(): Promise<string> {
    const next = await refetch();
    if (next.isError) return isUnavailable(next.error) ? "Can't reach the server. Try again in a moment." : "Couldn't load more cards. Try again.";
    setRound((r) => r + 1);
    return '';
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Review</h1>
      {due.data ? (
        <ReviewRound key={round} due={due.data} focusFirst={round > 0} more={more} />
      ) : due.isError ? (
        <div role="alert" className="space-y-3">
          <p>Couldn't load your review cards.</p>
          <Button onClick={() => void refetch()}>Try again</Button>
          <p>{pathLink}</p>
        </div>
      ) : (
        <p role="status" className="text-muted">
          Loading your review cards…
        </p>
      )}
    </div>
  );
}
