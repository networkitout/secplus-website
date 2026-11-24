import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../app.js';
import { requireAuth } from '../../http.js';
import { leaderboard } from './repo.js';

const query = z.object({ period: z.enum(['week', 'all']) });

export function leaderboardRouter(deps: AppDeps): Router {
  const { db, now } = deps;
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const parsed = query.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'period must be "week" or "all"' });
      return;
    }
    res.json(await leaderboard(db, req.user!.id, parsed.data.period, now()));
  });

  return router;
}
