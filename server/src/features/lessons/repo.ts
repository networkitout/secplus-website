import type { Db } from '../../db/db.js';
import { XP } from '../../services/xp.js';
import { addFlashcards } from '../review/repo.js';
import { awardXp } from '../xp/repo.js';

export type Progress = { sectionsDone: string[]; completedAt: Date | null };

function parseDone(v: unknown): string[] {
  const parsed = typeof v === 'string' ? JSON.parse(v) : v;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

export async function getProgress(db: Db, userId: number, objective: string): Promise<Progress> {
  const rows = await db.query<{ sections_done: unknown; completed_at: Date | null }>(
    'SELECT sections_done, completed_at FROM lesson_progress WHERE user_id = ? AND objective = ?',
    [userId, objective],
  );
  const r = rows[0];
  return { sectionsDone: r ? parseDone(r.sections_done) : [], completedAt: r?.completed_at ? new Date(r.completed_at) : null };
}

type MarkArgs = { userId: number; objective: string; sectionId: string; allSectionIds: string[]; flashcardIds: string[]; today: string; now: Date };

/**
 * Marks a section done (a repeat is a no-op). When it completes the lesson, sets `completed_at`, awards
 * the lesson XP once and adds the objective's flashcards to the learner's review cards, due today.
 * Runs under a row lock so parallel requests cannot lose a section or complete the lesson twice; a request
 * that loses a deadlock is run again by `db.tx`.
 */
export async function markSection(db: Db, a: MarkArgs): Promise<Progress & { xp: number }> {
  return db.tx(async (tx) => {
    // ON DUPLICATE KEY UPDATE takes the exclusive row lock straight away (INSERT IGNORE would take a shared one).
    await tx.exec("INSERT INTO lesson_progress (user_id, objective, sections_done) VALUES (?, ?, '[]') ON DUPLICATE KEY UPDATE objective = objective", [
      a.userId,
      a.objective,
    ]);
    const [row] = await tx.query<{ sections_done: unknown; completed_at: Date | null }>(
      'SELECT sections_done, completed_at FROM lesson_progress WHERE user_id = ? AND objective = ? FOR UPDATE',
      [a.userId, a.objective],
    );
    const done = new Set(parseDone(row!.sections_done));
    let completedAt = row!.completed_at ? new Date(row!.completed_at) : null;
    let xp = 0;
    if (!done.has(a.sectionId)) {
      done.add(a.sectionId);
      const sectionsDone = a.allSectionIds.filter((id) => done.has(id));
      const completes = !completedAt && a.allSectionIds.every((id) => done.has(id));
      if (completes) completedAt = a.now;
      await tx.exec('UPDATE lesson_progress SET sections_done = ?, completed_at = ? WHERE user_id = ? AND objective = ?', [
        JSON.stringify(sectionsDone),
        completedAt,
        a.userId,
        a.objective,
      ]);
      if (completes) {
        if (await awardXp(tx, { userId: a.userId, amount: XP.lessonComplete, reason: 'lesson', ref: a.objective, now: a.now })) {
          xp = XP.lessonComplete;
        }
        await addFlashcards(tx, a.userId, a.flashcardIds, a.today);
      }
    }
    return { sectionsDone: a.allSectionIds.filter((id) => done.has(id)), completedAt, xp };
  });
}
