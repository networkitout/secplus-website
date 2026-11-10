import type { Answer, Feedback, Lab } from '../../../../shared/types.js';
import type { Content } from '../../content/loader.js';
import type { Db } from '../../db/db.js';
import { AnswerShapeError, grade } from '../../services/scoring.js';
import { safeTimeZone } from '../../services/time.js';
import { XP } from '../../services/xp.js';
import { unlockedDomains } from '../access.js';
import { recordAnswer } from '../answers/repo.js';
import { awardXp, evaluateBadges } from '../xp/repo.js';

export const LAB_PASS_PCT = 80;

export const labPassed = (scorePct: number): boolean => scorePct >= LAB_PASS_PCT;

/** A lab is open when its domain is unlocked and every objective it covers has a completed lesson. */
export async function labsAvailability(db: Db, content: Content, userId: number): Promise<Map<string, boolean>> {
  const open = new Set(await unlockedDomains(db, content, userId));
  const done = new Set(
    (
      await db.query<{ objective: string }>(
        'SELECT objective FROM lesson_progress WHERE user_id = ? AND completed_at IS NOT NULL',
        [userId],
      )
    ).map((r) => r.objective),
  );
  return new Map(
    [...content.labs.values()].map((lab) => [lab.id, open.has(lab.domain) && lab.objectives.every((o) => done.has(o))]),
  );
}

export async function labResultSummary(
  db: Db,
  userId: number,
): Promise<Map<string, { bestScore: number; passed: boolean }>> {
  const rows = await db.query<{ lab_id: string; best: string | number; passed: string | number }>(
    'SELECT lab_id, MAX(score_pct) AS best, MAX(passed) AS passed FROM lab_results WHERE user_id = ? GROUP BY lab_id',
    [userId],
  );
  return new Map(rows.map((r) => [r.lab_id, { bestScore: Number(r.best), passed: Number(r.passed) === 1 }]));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Scores a lab submission, which must answer every step: the result reveals every step's solution. Every
 * answer is graded first (a missing or malformed one throws AnswerShapeError before anything is written);
 * then the attempts, XP, result row and badges are written in one transaction.
 */
export async function submitLab(
  db: Db,
  content: Content,
  a: {
    user: { id: number; timeZone: string };
    lab: Lab;
    answers: Record<string, Answer>;
    now: Date;
  },
): Promise<{ scorePct: number; passed: boolean; steps: Record<string, Feedback>; xp: number; newBadges: string[] }> {
  const { user, lab, answers, now } = a;
  const given = (step: Lab['steps'][number]): Answer => {
    const answer = Object.hasOwn(answers, step.id) ? answers[step.id] : undefined;
    if (!answer) throw new AnswerShapeError(`missing answer for step ${step.id}`);
    return answer;
  };
  for (const step of lab.steps) grade(step, given(step));

  return db.tx(async (tx) => {
    const steps: Record<string, Feedback> = {};
    const badges = new Set<string>();
    let xp = 0;
    let fractions = 0;
    for (const step of lab.steps) {
      const r = await recordAnswer(tx, content, { user, question: step, answer: given(step), context: 'lab', now });
      steps[step.id] = r.feedback;
      fractions += r.feedback.fraction;
      xp += r.xp;
      r.newBadges.forEach((b) => badges.add(b));
    }
    const scorePct = round2((fractions / lab.steps.length) * 100);
    const passed = labPassed(scorePct);
    await tx.exec('INSERT INTO lab_results (user_id, lab_id, score_pct, passed, created_at) VALUES (?, ?, ?, ?, ?)', [
      user.id,
      lab.id,
      scorePct,
      passed ? 1 : 0,
      now,
    ]);
    if (passed && (await awardXp(tx, { userId: user.id, amount: XP.labPass, reason: 'lab-pass', ref: lab.id, now }))) {
      xp += XP.labPass;
    }
    (await evaluateBadges(tx, user.id, safeTimeZone(user.timeZone), now)).forEach((b) => badges.add(b));
    return { scorePct, passed, steps, xp, newBadges: [...badges] };
  });
}
