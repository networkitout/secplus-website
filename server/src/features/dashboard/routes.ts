import { Router } from 'express';
import type { AppDeps } from '../../app.js';
import { requireAuth } from '../../http.js';
import { toPublicQuestion } from '../../services/scoring.js';
import { assertObjectiveOpen } from '../access.js';
import { dashboardFor, pathFor, practiceIds } from './repo.js';

export function pathRouter(deps: AppDeps): Router {
  const { db, content } = deps;
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res) => {
    res.json(await pathFor(db, content, req.user!));
  });
  return router;
}

export function dashboardRouter(deps: AppDeps): Router {
  const { db, content, now } = deps;
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res) => {
    res.json(await dashboardFor(db, content, req.user!, now()));
  });
  return router;
}

export function practiceRouter(deps: AppDeps): Router {
  const { db, content } = deps;
  const router = Router();
  router.use(requireAuth);
  router.get('/:objective', async (req, res) => {
    const user = req.user!;
    const objective = String(req.params.objective);
    await assertObjectiveOpen(db, content, user.id, objective);
    const ids = await practiceIds(db, content, user.id, objective);
    res.json({ questions: ids.map((id) => toPublicQuestion(content.questions.get(id)!, `${user.id}:${id}`)) });
  });
  return router;
}
