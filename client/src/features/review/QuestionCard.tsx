import { useRef, useState } from 'react';
import type { Answer } from '../../../../shared/types';
import { api, isUnavailable } from '../../api/client';
import type { ReviewCard, ReviewResponse } from '../../api/types';
import { formatDay } from '../../lib/dates';
import { Button } from '../../ui/Button';
import { usePressGuard } from '../../ui/pressGuard';
import { initialAnswer, isComplete, QuestionView } from '../questions/QuestionView';
import { BOXES, cardUrl, type CardProps } from './parts';
import { problemOf, ProblemNote, type Problem } from './ProblemNote';

function boxNote(res: ReviewResponse): string {
  const where = res.box > 1 ? `Now in box ${res.box} of ${BOXES}.` : 'Back to box 1.';
  return `${where} Due again ${formatDay(res.dueOn)}.`;
}

/** A question card of the round: Check, the server's marking, then on to the next card. */
export function QuestionCard({
  card,
  last,
  onReviewed,
  onNext,
  onSkip,
}: CardProps<Extract<ReviewCard, { kind: 'question' }>> & { last: boolean }) {
  const { question } = card;
  const [value, setValue] = useState<Answer | null>(null);
  const [marked, setMarked] = useState<{ answer: Answer; res: ReviewResponse } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  // Check gives way to Next in the same place, and the card itself has taken the place of the one before:
  // a press that arrives straight after either is ignored.
  const guard = usePressGuard(marked !== null);

  async function check() {
    if (!guard.settled()) return;
    const answer = value ?? initialAnswer(question);
    if (sending.current || !answer || marked) return;
    sending.current = true;
    setBusy(true);
    try {
      const res = await api.post<ReviewResponse>(cardUrl(card), { answer });
      setProblem(null);
      setMarked({ answer, res });
      // The request guard is released below, before React has shown Next in place of Check: a press that
      // is handled in between must not review the card again.
      guard.restart();
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

  function next() {
    if (guard.settled()) onNext();
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
      {problem && <ProblemNote problem={problem} onSkip={onSkip} />}
      <div className="flex justify-end">
        {marked ? (
          <Button onClick={next}>{last ? 'Finish' : 'Next'}</Button>
        ) : (
          (!problem || problem.canRetry) && (
            <Button disabled={!isComplete(question, value)} onClick={() => void check()}>
              {problem ? 'Try again' : 'Check'}
            </Button>
          )
        )}
      </div>
    </div>
  );
}
