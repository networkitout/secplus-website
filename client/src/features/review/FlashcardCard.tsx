import { useRef, useState, type RefObject } from 'react';
import { api } from '../../api/client';
import type { FlashcardDefinition, ReviewCard, ReviewResponse } from '../../api/types';
import { FlashcardView } from './FlashcardView';
import { cardUrl, type CardProps } from './parts';
import { problemOf, ProblemNote, type Problem } from './ProblemNote';

/** A flashcard of the round: asks the server for its definition and tells it how the learner answered. */
export function FlashcardCard({
  card,
  scope,
  onReviewed,
  onNext,
  onSkip,
}: CardProps<Extract<ReviewCard, { kind: 'flashcard' }>> & { scope: RefObject<HTMLElement | null> }) {
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
      busy={busy || null}
      scope={scope}
      onReveal={() => void reveal()}
      onGrade={(knewIt) => void grade(knewIt)}
    >
      {problem && (
        <ProblemNote problem={problem} onRetry={unsaved === null ? undefined : () => void grade(unsaved)} onSkip={onSkip} />
      )}
    </FlashcardView>
  );
}
