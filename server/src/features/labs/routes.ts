import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../app.js';
import { HttpError, requireAuth, validate } from '../../http.js';
import { AnswerShapeError, answerSchema, toPublicQuestion } from '../../services/scoring.js';
import { labResultSummary, labsAvailability, submitLab } from './repo.js';

const submitBody = z.object({ answers: z.record(z.string().max(40), answerSchema) }).strict();

export function labsRouter(deps: AppDeps): Router {
  const { db, content, now } = deps;
  const router = Router();
  router.use(requireAuth);

  /** 404 for an unknown lab, 403 while it is still locked for this learner. */
  async function openLab(userId: number, id: string) {
    const lab = content.labs.get(id);
    if (!lab) throw new HttpError(404, 'Lab not found');
    if (!(await labsAvailability(db, content, userId)).get(lab.id)) {
      throw new HttpError(403, 'Finish the lessons for this lab and unlock its domain first');
    }
    return lab;
  }

  router.get('/', async (req, res) => {
    const userId = req.user!.id;
    const [available, results] = await Promise.all([
      labsAvailability(db, content, userId),
      labResultSummary(db, userId),
    ]);
    const labs = [...content.labs.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((lab) => ({
        id: lab.id,
        domain: lab.domain,
        title: lab.title,
        objectives: lab.objectives,
        available: available.get(lab.id) ?? false,
        bestScore: results.get(lab.id)?.bestScore ?? null,
        passed: results.get(lab.id)?.passed ?? false,
      }));
    res.json({ labs });
  });

  router.get('/:id', async (req, res) => {
    const user = req.user!;
    const lab = await openLab(user.id, String(req.params.id));
    res.json({
      id: lab.id,
      title: lab.title,
      scenario: lab.scenario,
      steps: lab.steps.map((s) => toPublicQuestion(s, `${user.id}:${s.id}`)),
    });
  });

  router.post('/:id/submit', validate(submitBody), async (req, res) => {
    const user = req.user!;
    const lab = await openLab(user.id, String(req.params.id));
    const answers = (req.body as z.infer<typeof submitBody>).answers;
    const known = new Set(lab.steps.map((s) => s.id));
    const stray = Object.keys(answers).find((k) => !known.has(k));
    if (stray) throw new HttpError(400, `Unknown step id: ${stray}`);
    // The response reveals every step's solution, so every step must have been answered.
    if (!lab.steps.every((s) => Object.hasOwn(answers, s.id))) throw new HttpError(400, 'Every step of the lab needs an answer');
    try {
      res.json(await submitLab(db, content, { user, lab, answers, now: now() }));
    } catch (err) {
      if (err instanceof AnswerShapeError) throw new HttpError(400, err.message);
      throw err;
    }
  });

  return router;
}
