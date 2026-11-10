import { useId, useRef, useState } from 'react';
import type { Answer, Feedback, PublicQuestion } from '../../../../shared/types';
import { api, isUnavailable } from '../../api/client';
import type { AnswerResponse, Rewards } from '../../api/types';
import { Button } from '../../ui/Button';
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
  const [error, setError] = useState('');
  const container = useRef<HTMLElement>(null);
  const headingId = useId();

  async function check() {
    const answer = value ?? initialAnswer(question);
    if (sending || !answer) return;
    setSending(true);
    try {
      const { feedback, xp, newBadges } = await api.post<AnswerResponse>('answers', { questionId: question.id, answer });
      setError('');
      // The button is removed once the answer is marked: keep keyboard focus in the check.
      if (container.current?.contains(document.activeElement)) container.current.focus();
      onAnswered({ answer, feedback, xp, newBadges });
    } catch (err) {
      setError(
        isUnavailable(err)
          ? "Couldn't send your answer. It has not been marked yet."
          : "Couldn't check your answer. Try again.",
      );
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
              {error}
            </p>
          )}
          <Button disabled={!isComplete(question, value)} onClick={() => void check()}>
            {error ? 'Try again' : 'Check answer'}
          </Button>
        </div>
      )}
    </section>
  );
}
