import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../app.js';
import { requireAuth, validate } from '../../http.js';
import { isTimeZoneName } from '../../services/time.js';
import { loadAccountUser } from '../auth/repo.js';

function isCalendarDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
}

const settingsBody = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(64, 'Name must be at most 64 characters').optional(),
    timeZone: z.string().max(64).refine(isTimeZoneName, 'Unknown time zone').optional(),
    examDate: z.string().refine(isCalendarDate, 'Exam date must be a valid date in YYYY-MM-DD format').nullable().optional(),
    hideFromLeaderboard: z.boolean().optional(),
  })
  .strict();

export function settingsRouter(deps: AppDeps): Router {
  const { db } = deps;
  const router = Router();
  router.use(requireAuth);

  router.put('/', validate(settingsBody), async (req, res) => {
    const body = req.body as z.infer<typeof settingsBody>;
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown) => {
      sets.push(`${column} = ?`);
      params.push(value);
    };
    if (body.name !== undefined) set('name', body.name);
    if (body.timeZone !== undefined) set('time_zone', body.timeZone);
    if (body.examDate !== undefined) set('exam_date', body.examDate);
    if (body.hideFromLeaderboard !== undefined) set('hide_from_leaderboard', body.hideFromLeaderboard ? 1 : 0);
    if (sets.length > 0) await db.exec(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, req.user!.id]);
    res.json({ user: await loadAccountUser(db, req.user!.id) });
  });

  return router;
}
