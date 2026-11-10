import { motion, useReducedMotion } from 'motion/react';
import { useId } from 'react';
import type { Answer, Feedback, Item, PublicQuestion } from '../../../../shared/types';
import { usePressGuard } from '../../ui/pressGuard';
import { CategorizeQuestion } from './CategorizeQuestion';
import { FeedbackPanel } from './FeedbackPanel';
import { MatchQuestion } from './MatchQuestion';
import { MultiChoice } from './MultiChoice';
import { OrderQuestion } from './OrderQuestion';
import { SingleChoice } from './SingleChoice';

const SHAKE = [0, -8, 8, -5, 5, 0];
const PULSE = { opacity: [0.9, 0], scale: [1, 1.015] };
const PULSE_REST = { opacity: 0, scale: 1 };

/**
 * True when the answer can be submitted. Only ids that the question has count. An `order` question always
 * can be submitted: its served order is an answer (see `initialAnswer`).
 */
export function isComplete(q: PublicQuestion, a: Answer | null): boolean {
  const has = (items: Item[], id: string | undefined) => items.some((item) => item.id === id);
  switch (q.type) {
    case 'single':
      return a?.type === 'single' && has(q.options, a.choice);
    case 'multi':
      return a?.type === 'multi' && a.choices.some((choice) => has(q.options, choice));
    case 'order':
      return true;
    case 'match': {
      if (a?.type !== 'match') return false;
      const { pairs } = a;
      return q.left.every((item) => has(q.right, pairs[item.id]));
    }
    case 'categorize': {
      if (a?.type !== 'categorize') return false;
      const { placements } = a;
      return q.items.every((item) => has(q.buckets, placements[item.id]));
    }
  }
}

/**
 * The answer a question has before the learner touches it: the served order for an `order` question, none
 * for the other types. `QuestionView` never emits it; a screen submits `value ?? initialAnswer(question)`.
 */
export function initialAnswer(q: PublicQuestion): Answer | null {
  return q.type === 'order' ? { type: 'order', order: q.items.map((item) => item.id) } : null;
}

/**
 * One question of any type, as a controlled input. With `feedback` it is locked and shows the marking;
 * `disabled` locks it without a result. Renders the prompt itself. It emits nothing during the settle
 * window after a question appears (see `usePressGuard`).
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
  // A press that was meant for the screen before (the second tap of a double tap on "Next") lands on
  // whatever the new question has put under it. For a moment after a question appears it takes no answer.
  const guard = usePressGuard(question.id);
  const change = (a: Answer) => {
    if (guard.settled()) onChange(a);
  };
  const common = { onChange: change, feedback, locked: disabled || feedback !== undefined, labelledBy: promptId };
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
      {/* Always in the page, so that the result is announced when it is added. Named, because the
          drag-and-drop types add live regions of their own. */}
      <div role="status" aria-label="Result">
        {feedback && <FeedbackPanel feedback={feedback} />}
      </div>
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
