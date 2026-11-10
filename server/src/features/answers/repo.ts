import type { Answer, Feedback, Question } from '../../../../shared/types.js';
import type { Content } from '../../content/loader.js';
import type { Db } from '../../db/db.js';
import { feedbackFor } from '../../services/scoring.js';
import { localDate, safeTimeZone } from '../../services/time.js';
import { XP } from '../../services/xp.js';
import { scheduleMiss } from '../review/repo.js';
import { awardXp, evaluateBadges } from '../xp/repo.js';

/** The (assessment, question) pair already has an attempt; nothing was awarded or scheduled. */
export class DuplicateAttemptError extends Error {
  constructor() {
    super('This question was already answered in this assessment');
    this.name = 'DuplicateAttemptError';
  }
}

export type AnswerContext = 'lesson' | 'quiz' | 'review' | 'exam' | 'lab';

/**
 * Grades an answer, stores the attempt, awards XP and schedules a review card for a miss (not for labs
 * or review), then evaluates badges. Throws AnswerShapeError for a mismatched answer type and
 * DuplicateAttemptError when `assessmentId` already holds an attempt for the question.
 */
export async function recordAnswer(
  db: Db,
  _content: Content,
  a: {
    user: { id: number; timeZone: string };
    question: Question;
    answer: Answer;
    context: AnswerContext;
    assessmentId?: number;
    now: Date;
  },
): Promise<{ feedback: Feedback; xp: number; newBadges: string[] }> {
  const { user, question, answer, context, now } = a;
  const feedback = feedbackFor(question, answer);
  const tz = safeTimeZone(user.timeZone);
  const today = localDate(now, tz);

  const xp = await db.tx(async (tx) => {
    try {
      await tx.exec(
        'INSERT INTO attempts (user_id, question_id, correct, context, assessment_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [user.id, question.id, feedback.correct ? 1 : 0, context, a.assessmentId ?? null, now],
      );
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') throw new DuplicateAttemptError();
      throw err;
    }
    if (!feedback.correct) {
      if (context !== 'review' && context !== 'lab') await scheduleMiss(tx, user.id, `q:${question.id}`, today);
      return 0;
    }
    const first = XP.firstCorrect * question.difficulty;
    if (await awardXp(tx, { userId: user.id, amount: first, reason: 'first-correct', ref: question.id, now })) return first;
    const repeat = await awardXp(tx, {
      userId: user.id,
      amount: XP.repeatCorrect,
      reason: 'repeat-correct',
      ref: `${question.id}@${today}`,
      now,
    });
    return repeat ? XP.repeatCorrect : 0;
  });

  const newBadges = await evaluateBadges(db, user.id, tz, now);
  return { feedback, xp, newBadges };
}
