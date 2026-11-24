import { useId, useRef, useState } from 'react';
import type { Answer, Feedback, PublicQuestion } from '../../../../shared/types';
import { api, isTransient } from '../../api/client';
import type { AnswerResponse, Rewards } from '../../api/types';
import { Button } from '../../ui/Button';
import { usePressGuard } from '../../ui/pressGuard';
import { initialAnswer, isComplete, QuestionView } from '../questions/QuestionView';

/** An inline check that has been marked: what the learner sent and what the server said. */
export type CheckResult = { answer: Answer; feedback: Feedback };

/**
 * One check question inside a lesson section. The answer is marked by the server; until `result` is given
 * the question is open. A failed request keeps the chosen answer and offers a retry.
 */
export function InlineCheck({
  question,
  result,
  onAnswered,
}: {
  question: PublicQuestion;
  result?: CheckResult;
  onAnswered(answered: CheckResult & Rewards): void;
}) {
  const [value, setValue] = useState<Answer | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<'retry' | 'reload' | null>(null);
  const inFlight = useRef(false);
  const container = useRef<HTMLElement>(null);
  const headingId = useId();
  // The check arrives with its section: a press that was meant for the section before it (a second tap on
  // Next) must not mark it unseen. A failed attempt does not start the pause again, so "Try again" works at once.
  const guard = usePressGuard();

  async function check() {
    const answer = value ?? initialAnswer(question);
    // A second press while the first answer is on its way, or after it has been marked, must not send it again.
    if (inFlight.current || !answer || !guard.settled()) return;
    inFlight.current = true;
    setSending(true);
    try {
      const { feedback, xp, newBadges } = await api.post<AnswerResponse>('answers', { questionId: question.id, answer });
      setError(null);
      // The button is removed once the answer is marked: keep keyboard focus in the check.
      if (container.current?.contains(document.activeElement)) container.current.focus();
      onAnswered({ answer, feedback, xp, newBadges });
    } catch (err) {
      // Only a failed attempt may be sent again. After a marked answer the guard stays shut: the button is
      // still there until the page has stored the result, and a press in that moment must not post again.
      inFlight.current = false;
      setError(isTransient(err) ? 'retry' : 'reload');
    } finally {
      setSending(false);
    }
  }

  return (
    <section ref={container} tabIndex={-1} aria-labelledby={headingId} className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h3 id={headingId} className="font-mono text-xs uppercase tracking-wide text-accent">
        Check your understanding
      </h3>
      <QuestionView
        question={question}
        value={result ? result.answer : value}
        onChange={setValue}
        feedback={result?.feedback}
        disabled={sending}
      />
      {!result && (
        <div className="space-y-2">
          {error && (
            <p role="alert" className="text-sm text-bad">
              {error === 'retry'
                ? "Couldn't send your answer. It has not been marked yet."
                : "Couldn't check your answer. This lesson may have changed since you opened it: reload the page and try again."}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {/* Not disabled while sending: a disabled button would drop keyboard focus. */}
            <Button disabled={!isComplete(question, value)} aria-busy={sending} onClick={() => void check()}>
              {error === 'retry' ? 'Try again' : 'Check answer'}
            </Button>
            <p role="status" className="text-sm text-muted">
              {sending ? 'Checking your answer…' : ''}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
