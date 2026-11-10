import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../app.js';
import { HttpError, requireAuth, validate } from '../../http.js';
import { answerSchema } from '../../services/scoring.js';
import { finalize, loadOwned, saveAnswer, settleIfExpired, startAssessment, viewOf } from './repo.js';

const startBody = z
  .object({ kind: z.enum(['objective', 'domain', 'mock']), scope: z.string().min(1).max(8).optional() })
  .strict()
  .refine((b) => b.kind === 'mock' || b.scope !== undefined, { message: 'scope is required' });

const answerBody = z
  .object({ questionId: z.string().min(1).max(40), answer: answerSchema.optional(), flagged: z.boolean().optional() })
  .strict()
  .refine((b) => b.answer !== undefined || b.flagged !== undefined, { message: 'answer or flagged is required' });

export function assessmentsRouter(deps: AppDeps): Router {
  const { db, content, now } = deps;
  const router = Router();
  router.use(requireAuth);

  const idParam = (raw: unknown): number => {
    const s = String(raw);
    if (!/^\d{1,10}$/.test(s)) throw new HttpError(404, 'Assessment not found');
    return Number(s);
  };

  router.post('/', validate(startBody), async (req, res) => {
    const { kind, scope } = req.body as z.infer<typeof startBody>;
    const { id, created } = await startAssessment(db, content, req.user!, { kind, scope: kind === 'mock' ? undefined : scope }, now());
    res.status(created ? 201 : 200).json({ id });
  });

  router.get('/:id', async (req, res) => {
    const user = req.user!;
    const row = await settleIfExpired(db, content, user, await loadOwned(db, user.id, idParam(req.params.id)), now());
    res.json(viewOf(content, row));
  });

  router.put('/:id/answers', validate(answerBody), async (req, res) => {
    res.json(await saveAnswer(db, content, req.user!, idParam(req.params.id), req.body, now()));
  });

  router.post('/:id/submit', async (req, res) => {
    const user = req.user!;
    const id = idParam(req.params.id);
    await loadOwned(db, user.id, id);
    res.json({ result: await finalize(db, content, user, id, now()) });
  });

  return router;
}
