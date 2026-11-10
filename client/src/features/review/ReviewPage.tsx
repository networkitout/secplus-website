import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Answer } from '../../../../shared/types';
import { api, ApiError, isUnavailable } from '../../api/client';
import type { FlashcardDefinition, ReviewCard, ReviewDueResponse, ReviewResponse } from '../../api/types';
import { Button } from '../../ui/Button';
import { initialAnswer, isComplete, QuestionView } from '../questions/QuestionView';
import { FlashcardView } from './FlashcardView';

const BOXES = 5;

const pathLink = (
  <Link to="/" className="text-accent underline underline-offset-2">
    Back to path
  </Link>
);

/**
 * A calendar date from the server (`YYYY-MM-DD`, already in the learner's time zone) in the learner's
 * locale. It is read as that day itself: parsing it as an instant would show the day before in time zones
 * behind UTC.
 */
export function formatDay(date: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parts) return date;
  const day = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(day);
}

const cardUrl = (card: ReviewCard) => `review/${encodeURIComponent(card.cardId)}`;

/** What went wrong with a card, and what the learner can do about it. */
type Problem = { message: string; canRetry: boolean; canSkip: boolean };

function problemOf(err: unknown, failed: string): Problem {
  const status = err instanceof ApiError ? err.status : 0;
  if (status === 404) return { message: 'This card is no longer available.', canRetry: false, canSkip: true };
  // Not due: it was reviewed in another tab or on another device in the meantime.
  if (status === 409) return { message: 'This card has already been reviewed and is not due today.', canRetry: false, canSkip: true };
  if (isUnavailable(err)) return { message: failed, canRetry: true, canSkip: false };
  // Anything else may fail the same way every time, so there is always a way past it.
  return { message: failed, canRetry: status >= 500, canSkip: true };
}

function ProblemNote({ problem, onRetry, onSkip }: { problem: Problem; onRetry?: () => void; onSkip(): void }) {
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
        <Button variant="secondary" onClick={onSkip}>
          Skip this card
        </Button>
      )}
    </div>
  );
}

function boxNote(res: ReviewResponse): string {
  const where = res.box > 1 ? `Now in box ${res.box} of ${BOXES}.` : 'Back to box 1.';
  return `${where} Due again ${formatDay(res.dueOn)}.`;
}

type CardProps<C extends ReviewCard> = {
  card: C;
  /** The server has moved the card: called once, with its response. */
  onReviewed(card: ReviewCard, res: ReviewResponse): void;
  /** On to the next card. */
  onNext(): void;
};

function FlashcardCard({ card, onReviewed, onNext }: CardProps<Extract<ReviewCard, { kind: 'flashcard' }>>) {
  const [definition, setDefinition] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  // The answer that could not be saved; "Try again" sends it again.
  const [unsaved, setUnsaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<'' | 'reveal' | 'grade'>('');
  // Set and read in the same tick, which state is not: two presses in a row must not send twice.
  const sending = useRef(false);

  async function reveal() {
    if (sending.current || definition !== null) return;
    sending.current = true;
    setBusy('reveal');
    try {
      const res = await api.get<FlashcardDefinition>(`review/flashcard/${encodeURIComponent(card.cardId)}`);
      setProblem(null);
      setDefinition(res.definition);
    } catch (err) {
      setProblem(problemOf(err, "Couldn't load the answer. Try again."));
    } finally {
      sending.current = false;
      setBusy('');
    }
  }

  async function grade(knewIt: boolean) {
    if (sending.current || definition === null) return;
    sending.current = true;
    setBusy('grade');
    let res: ReviewResponse;
    try {
      res = await api.post<ReviewResponse>(cardUrl(card), { knewIt });
    } catch (err) {
      setProblem(problemOf(err, "Couldn't save your answer. This card is still open."));
      setUnsaved(knewIt);
      sending.current = false;
      setBusy('');
      return;
    }
    // `sending` stays set: this card is done, and nothing more may be sent for it.
    onReviewed(card, res);
    onNext();
  }

  return (
    <FlashcardView
      term={card.term}
      definition={definition}
      locked={problem !== null && !problem.canRetry}
      onReveal={() => void reveal()}
      onGrade={(knewIt) => void grade(knewIt)}
    >
      {problem && (
        <ProblemNote problem={problem} onRetry={unsaved === null ? undefined : () => void grade(unsaved)} onSkip={onNext} />
      )}
      <p role="status" className="text-sm text-muted">
        {busy === 'reveal' ? 'Loading the answer…' : busy === 'grade' ? 'Saving…' : ''}
      </p>
    </FlashcardView>
  );
}

function QuestionCard({ card, last, onReviewed, onNext }: CardProps<Extract<ReviewCard, { kind: 'question' }>> & { last: boolean }) {
  const { question } = card;
  const [value, setValue] = useState<Answer | null>(null);
  const [marked, setMarked] = useState<{ answer: Answer; res: ReviewResponse } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const container = useRef<HTMLDivElement>(null);

  async function check(e: MouseEvent) {
    // The second click of a double click on the button before this one can land here.
    if (e.detail > 1) return;
    const answer = value ?? initialAnswer(question);
    if (sending.current || !answer || marked) return;
    sending.current = true;
    setBusy(true);
    try {
      const res = await api.post<ReviewResponse>(cardUrl(card), { answer });
      setProblem(null);
      setMarked({ answer, res });
      onReviewed(card, res);
      // Check gives way to Next: keep keyboard focus by the question and its result.
      if (container.current?.contains(document.activeElement)) container.current.focus();
    } catch (err) {
      setProblem(
        problemOf(err, isUnavailable(err) ? "Couldn't send your answer. It has not been marked yet." : "Couldn't check your answer."),
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function next(e: MouseEvent) {
    // The second click of a double click on Check can land here, once the button has changed.
    if (e.detail > 1) return;
    onNext();
  }

  return (
    <div ref={container} tabIndex={-1} role="group" aria-label="Question card" className="space-y-4 rounded-sm">
      <QuestionView
        question={question}
        value={marked ? marked.answer : value}
        onChange={setValue}
        feedback={marked?.res.feedback}
        disabled={busy || marked !== null}
      />
      {marked && <p className="text-sm text-muted">{boxNote(marked.res)}</p>}
      {problem && <ProblemNote problem={problem} onSkip={onNext} />}
      <div className="flex justify-end">
        {marked ? (
          <Button onClick={next}>{last ? 'Finish' : 'Next'}</Button>
        ) : (
          (!problem || problem.canRetry) && (
            <Button disabled={!isComplete(question, value)} onClick={(e) => void check(e)}>
              {problem ? 'Try again' : 'Check'}
            </Button>
          )
        )}
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-mono text-xl font-semibold">{children}</dd>
    </div>
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
  // The round keeps the cards it began with, whatever the query holds later.
  const [{ cards, total }] = useState(due);
  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState<Array<{ cardId: string } & ReviewResponse>>([]);
  const [moreError, setMoreError] = useState('');
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const loadingMore = useRef(false);
  // Something was reviewed since the header and the path last read their numbers.
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

  // After a round, and when a round is left half way, the header and the path read their numbers again.
  useEffect(() => {
    function refresh() {
      if (!stale.current) return;
      stale.current = false;
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['path'] });
    }
    if (finished) refresh();
    return refresh;
  }, [finished, queryClient]);

  /**
   * Every review response arrives here, once. Its `xp` is for Task 20's rewards provider (the review API
   * reports no badges); until then the header re-reads its totals.
   */
  function reviewed(done: ReviewCard, res: ReviewResponse) {
    setResponses((all) => (all.some((r) => r.cardId === done.cardId) ? all : [...all, { ...res, cardId: done.cardId }]));
    stale.current = true;
    if (res.xp > 0) void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }

  async function loadMore() {
    if (loadingMore.current) return;
    loadingMore.current = true;
    setMoreError(await more());
    loadingMore.current = false;
  }

  if (cards.length === 0) {
    return (
      <div className="space-y-3">
        <h2 ref={heading} tabIndex={-1} className="rounded-sm text-lg font-medium">
          Nothing due today.
        </h2>
        <p className="text-muted">
          Cards come back here on the day they are due: the flashcards of each lesson you finish, and every question you miss.
        </p>
        <p>{pathLink}</p>
      </div>
    );
  }

  if (!card) {
    // All of this comes from the responses: a card that was answered right is in a box above 1.
    const movedUp = responses.filter((r) => r.box > 1).length;
    const xp = responses.reduce((sum, r) => sum + r.xp, 0);
    const nextDue = responses.map((r) => r.dueOn).sort()[0];
    const skipped = cards.length - responses.length;
    const remaining = total - cards.length;
    return (
      <section aria-labelledby={headingId} className="space-y-5">
        <h2 id={headingId} ref={heading} tabIndex={-1} className="rounded-sm text-xl font-semibold">
          Review complete
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Cards reviewed">{responses.length}</Stat>
          <Stat label="Moved up">{movedUp}</Stat>
          <Stat label="Back to box 1">{responses.length - movedUp}</Stat>
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
          {nextDue && ' “Next due” is the first day on which one of these cards comes back.'}
        </p>
        {remaining > 0 && (
          <div className="space-y-2">
            <p>{`${count(remaining, 'more card is', 'more cards are')} due today.`}</p>
            <Button onClick={() => void loadMore()}>Review more</Button>
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

  const next = () => setIndex(index + 1);
  return (
    <section aria-labelledby={headingId} className="space-y-4">
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
        <FlashcardCard key={card.cardId} card={card} onReviewed={reviewed} onNext={next} />
      ) : (
        <QuestionCard key={card.cardId} card={card} last={index === cards.length - 1} onReviewed={reviewed} onNext={next} />
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
