import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../app.js';
import { HttpError, requireAuth, validate } from '../../http.js';
import { AnswerShapeError, answerSchema } from '../../services/scoring.js';
import { assertObjectiveOpen } from '../access.js';
import { recordAnswer } from './repo.js';

const body = z.object({ questionId: z.string().min(1).max(40), answer: answerSchema }).strict();

export function answersRouter(deps: AppDeps): Router {
  const { db, content, now } = deps;
  const router = Router();
  router.use(requireAuth);

  router.post('/', validate(body), async (req, res) => {
    const user = req.user!;
    const question = content.questions.get(req.body.questionId);
    if (!question) throw new HttpError(404, 'Question not found');
    await assertObjectiveOpen(db, content, user.id, question.objective);
    try {
      res.json(await recordAnswer(db, content, { user, question, answer: req.body.answer, context: 'lesson', now: now() }));
    } catch (err) {
      if (err instanceof AnswerShapeError) throw new HttpError(400, err.message);
      throw err;
    }
  });

  return router;
}
