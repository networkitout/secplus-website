import type { Answer, PublicQuestion } from '../../../../shared/types';
import { isComplete } from '../questions/QuestionView';

/**
 * How far a question in an exam has been answered. `partial`: something is filled in, but not everything
 * the question asks for (some of the matches, some of the items placed); it scores like no answer.
 */
export type AnswerState = 'answered' | 'partial' | 'unanswered';

export function answerState(question: PublicQuestion, answer: Answer | undefined): AnswerState {
  // An order question has no stored answer until the learner moves something, complete as its served order is.
  if (answer === undefined) return 'unanswered';
  if (isComplete(question, answer)) return 'answered';
  const filledIn =
    (answer.type === 'match' && Object.keys(answer.pairs).length > 0) ||
    (answer.type === 'categorize' && Object.keys(answer.placements).length > 0);
  return filledIn ? 'partial' : 'unanswered';
}
