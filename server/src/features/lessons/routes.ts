import { Router } from 'express';
import { z } from 'zod';
import type { LessonView } from '../../../../shared/types.js';
import type { AppDeps } from '../../app.js';
import { HttpError, requireAuth, validate } from '../../http.js';
import { toPublicQuestion } from '../../services/scoring.js';
import { localDate } from '../../services/time.js';
import { evaluateBadges } from '../xp/repo.js';
import { assertObjectiveOpen } from '../access.js';
import { getProgress, markSection } from './repo.js';

const progressBody = z.object({ sectionId: z.string().min(1).max(64) }).strict();

export function lessonsRouter(deps: AppDeps): Router {
  const { db, content, now } = deps;
  const router = Router();
  router.use(requireAuth);

  async function open(userId: number, objective: string) {
    await assertObjectiveOpen(db, content, userId, objective);
    const lesson = content.lessons.get(objective);
    if (!lesson) throw new HttpError(404, 'Lesson not found');
    return lesson;
  }

  router.get('/:objective', async (req, res) => {
    const user = req.user!;
    const objective = String(req.params.objective);
    const lesson = await open(user.id, objective);
    const view: LessonView = {
      ...lesson,
      sections: lesson.sections.map((s) => ({
        ...s,
        blocks: s.blocks.map((b) =>
          b.kind === 'check'
            ? { kind: 'check' as const, question: toPublicQuestion(content.questions.get(b.questionId)!, `${user.id}:${b.questionId}`) }
            : b,
        ),
      })),
    };
    const p = await getProgress(db, user.id, objective);
    res.json({ lesson: view, progress: { sectionsDone: p.sectionsDone, completedAt: p.completedAt?.toISOString() ?? null } });
  });

  router.post('/:objective/progress', validate(progressBody), async (req, res) => {
    const user = req.user!;
    const objective = String(req.params.objective);
    const lesson = await open(user.id, objective);
    const sectionId: string = req.body.sectionId;
    const allSectionIds = lesson.sections.map((s) => s.id);
    if (!allSectionIds.includes(sectionId)) throw new HttpError(400, 'Unknown section');
    const t = now();
    const p = await markSection(db, {
      userId: user.id,
      objective,
      sectionId,
      allSectionIds,
      flashcardIds: content.flashcards.filter((f) => f.objective === objective).map((f) => f.id),
      today: localDate(t, user.timeZone),
      now: t,
    });
    const newBadges = await evaluateBadges(db, user.id, user.timeZone, t);
    res.json({ sectionsDone: p.sectionsDone, completedAt: p.completedAt?.toISOString() ?? null, xp: p.xp, newBadges });
  });

  return router;
}
