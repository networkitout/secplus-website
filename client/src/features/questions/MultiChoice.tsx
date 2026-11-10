import { useId } from 'react';
import type { Answer, Feedback, PublicQuestion } from '../../../../shared/types';
import { ChoiceFeedback } from './FeedbackPanel';

const COUNT_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };

/** The number of options the prompt asks for ("Choose two", "Select 3"), or null when it does not say. */
function statedCount(prompt: string): number | null {
  const stated = /\b(?:choose|select|pick)\s+(?:the\s+)?(two|three|four|five|six|[2-6])(?![\w-])/i.exec(prompt);
  if (!stated) return null;
  const word = stated[1]!.toLowerCase();
  return COUNT_WORDS[word] ?? Number(word);
}

export function MultiChoice({
  question,
  value,
  onChange,
  feedback,
  locked,
  labelledBy,
}: {
  question: Extract<PublicQuestion, { type: 'multi' }>;
  value: Extract<Answer, { type: 'multi' }> | null;
  onChange(a: Answer): void;
  feedback?: Feedback;
  locked: boolean;
  labelledBy: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const count = statedCount(question.prompt);
  const chosenIds = value?.choices ?? [];
  const correct = feedback?.correctAnswer.type === 'multi' ? feedback.correctAnswer.choices : [];

  function toggle(optionId: string, on: boolean) {
    // Emitted in the served option order, whatever order the boxes were ticked in.
    const choices = question.options
      .map((o) => o.id)
      .filter((o) => (o === optionId ? on : chosenIds.includes(o)));
    onChange({ type: 'multi', choices });
  }

  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={count ? hintId : undefined} className="space-y-2">
      {count && (
        <p id={hintId} className="text-sm text-muted">
          Choose {count}
        </p>
      )}
      {question.options.map((option) => {
        const chosen = chosenIds.includes(option.id);
        const isCorrect = correct.includes(option.id);
        const feedbackId = `${id}-${option.id}`;
        const border = !feedback
          ? 'border-border has-[:checked]:border-accent'
          : isCorrect ? 'border-ok' : chosen ? 'border-bad' : 'border-border';
        return (
          <div key={option.id} className={`rounded-md border bg-surface p-3 ${border}`}>
            <label className={`flex items-start gap-3 ${locked ? '' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 accent-accent"
                checked={chosen}
                disabled={locked}
                aria-describedby={feedback ? feedbackId : undefined}
                onChange={(e) => toggle(option.id, e.target.checked)}
              />
              <span>{option.text}</span>
            </label>
            {feedback && (
              <ChoiceFeedback id={feedbackId} correct={isCorrect} chosen={chosen} why={feedback.why?.[option.id]} />
            )}
          </div>
        );
      })}
    </div>
  );
}
