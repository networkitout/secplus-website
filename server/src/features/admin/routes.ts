import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../app.js';
import { requireAdmin, requireAuth, validate } from '../../http.js';
import { createInvite, INVITE_DAYS } from '../auth/repo.js';
import { findActiveUserId, listUsers, setActive } from './repo.js';

const inviteBody = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('invite') }),
  z.object({ purpose: z.literal('reset'), userId: z.number().int().positive() }),
]);
const patchBody = z.object({ active: z.boolean() });

export function adminRouter(deps: AppDeps): Router {
  const { db, now } = deps;
  const router = Router();
  router.use(requireAuth, requireAdmin);

  router.get('/users', async (_req, res) => {
    res.json({ users: await listUsers(db) });
  });

  router.post('/invites', validate(inviteBody), async (req, res) => {
    const body = req.body as z.infer<typeof inviteBody>;
    const t = now();
    if (body.purpose === 'reset' && !(await findActiveUserId(db, body.userId))) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const token = await createInvite(db, {
      purpose: body.purpose,
      userId: body.purpose === 'reset' ? body.userId : undefined,
      createdBy: req.user!.id,
      now: t,
    });
    res.json({
      url: `/${body.purpose === 'reset' ? 'reset' : 'invite'}/${token}`,
      expiresAt: new Date(t.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    });
  });

  router.patch('/users/:id', validate(patchBody), async (req, res) => {
    if (!/^\d+$/.test(String(req.params.id))) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }
    const id = Number(String(req.params.id));
    if (id === req.user!.id) {
      res.status(400).json({ error: 'You cannot change your own active status' });
      return;
    }
    const found = await setActive(db, id, req.body.active);
    if (!found) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
