import { motion, useReducedMotion } from 'motion/react';
import { useId } from 'react';
import type { Answer, Feedback, PublicQuestion } from '../../../../shared/types';
import { CategorizeQuestion } from './CategorizeQuestion';
import { FeedbackPanel } from './FeedbackPanel';
import { MatchQuestion } from './MatchQuestion';
import { MultiChoice } from './MultiChoice';
import { OrderQuestion } from './OrderQuestion';
import { SingleChoice } from './SingleChoice';

const SHAKE = [0, -8, 8, -5, 5, 0];
const PULSE = { opacity: [0.9, 0], scale: [1, 1.015] };
const PULSE_REST = { opacity: 0, scale: 1 };

/** True when the answer can be submitted. An `order` question always can: its served order is an answer. */
export function isComplete(q: PublicQuestion, a: Answer | null): boolean {
  switch (q.type) {
    case 'single':
      return a?.type === 'single' && a.choice !== '';
    case 'multi':
      return a?.type === 'multi' && a.choices.length >= 1;
    case 'order':
      return true;
    case 'match': {
      if (a?.type !== 'match') return false;
      const { pairs } = a;
      return q.left.every((item) => Boolean(pairs[item.id]));
    }
    case 'categorize': {
      if (a?.type !== 'categorize') return false;
      const { placements } = a;
      return q.items.every((item) => Boolean(placements[item.id]));
    }
  }
}

/**
 * One question of any type, as a controlled input. With `feedback` it is locked and shows the marking;
 * `disabled` locks it without a result. Renders the prompt itself.
 */
export function QuestionView({
  question,
  value,
  onChange,
  feedback,
  disabled = false,
}: {
  question: PublicQuestion;
  value: Answer | null;
  onChange(a: Answer): void;
  feedback?: Feedback;
  disabled?: boolean;
}) {
  const promptId = useId();
  const reduced = useReducedMotion();
  const common = { onChange, feedback, locked: disabled || feedback !== undefined, labelledBy: promptId };
  // With `initial={false}` below, the result animations play when feedback arrives, not when a question
  // is first shown already marked.
  const animated = feedback !== undefined && !reduced;
  const pulse = animated && feedback.correct;
  const shake = animated && !feedback.correct;

  return (
    <motion.div
      className="relative"
      initial={false}
      animate={{ x: shake ? SHAKE : 0 }}
      transition={{ duration: 0.4 }}
    >
      <p id={promptId} className="mb-4 text-lg font-medium">
        {question.prompt}
      </p>
      {question.type === 'single' && (
        <SingleChoice key={question.id} question={question} value={value?.type === 'single' ? value : null} {...common} />
      )}
      {question.type === 'multi' && (
        <MultiChoice key={question.id} question={question} value={value?.type === 'multi' ? value : null} {...common} />
      )}
      {question.type === 'order' && (
        <OrderQuestion key={question.id} question={question} value={value?.type === 'order' ? value : null} {...common} />
      )}
      {question.type === 'match' && (
        <MatchQuestion key={question.id} question={question} value={value?.type === 'match' ? value : null} {...common} />
      )}
      {question.type === 'categorize' && (
        <CategorizeQuestion
          key={question.id}
          question={question}
          value={value?.type === 'categorize' ? value : null}
          {...common}
        />
      )}
      {/* Always in the page, so that the result is announced when it is added. */}
      <div role="status">{feedback && <FeedbackPanel feedback={feedback} />}</div>
      {!reduced && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-1 rounded-xl border-2 border-ok"
          initial={false}
          animate={pulse ? PULSE : PULSE_REST}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      )}
    </motion.div>
  );
}
