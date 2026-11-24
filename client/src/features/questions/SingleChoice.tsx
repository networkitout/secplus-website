import { useId } from 'react';
import type { Answer, Feedback, PublicQuestion } from '../../../../shared/types';
import { ChoiceFeedback } from './FeedbackPanel';

export function SingleChoice({
  question,
  value,
  onChange,
  feedback,
  locked,
  labelledBy,
}: {
  question: Extract<PublicQuestion, { type: 'single' }>;
  value: Extract<Answer, { type: 'single' }> | null;
  onChange(a: Answer): void;
  feedback?: Feedback;
  locked: boolean;
  labelledBy: string;
}) {
  const name = useId();
  const correct = feedback?.correctAnswer.type === 'single' ? feedback.correctAnswer.choice : undefined;

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="space-y-2">
      {question.options.map((option) => {
        const chosen = value?.choice === option.id;
        const feedbackId = `${name}-${option.id}`;
        const border = !feedback
          ? 'border-border has-[:checked]:border-accent'
          : option.id === correct ? 'border-ok' : chosen ? 'border-bad' : 'border-border';
        return (
          <div key={option.id} className={`rounded-md border bg-surface p-3 ${border}`}>
            <label className={`flex items-start gap-3 ${locked ? '' : 'cursor-pointer'}`}>
              <input
                type="radio"
                name={name}
                className="mt-1 size-4 shrink-0 accent-accent"
                checked={chosen}
                disabled={locked}
                aria-describedby={feedback ? feedbackId : undefined}
                onChange={() => onChange({ type: 'single', choice: option.id })}
              />
              <span className="[overflow-wrap:anywhere]">{option.text}</span>
            </label>
            {feedback && (
              <ChoiceFeedback
                id={feedbackId}
                correct={option.id === correct}
                chosen={chosen}
                why={feedback.why?.[option.id]}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
