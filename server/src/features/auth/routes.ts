import bcrypt from 'bcryptjs';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { AppDeps } from '../../app.js';
import {
  clearSessionCookie,
  readSessionCookie,
  requireAuth,
  startSession,
  validate,
  type AuthUser,
} from '../../http.js';
import { findInvite, loadAccountUser, LOGIN_PATTERN, MIN_PASSWORD_LENGTH } from './repo.js';
import { hashToken } from './tokens.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const INVITE_KEEP_MS = 30 * 24 * 60 * 60 * 1000; // expired invites keep answering 410 for a month

const MAX_PASSWORD_BYTES = 72; // bcrypt ignores everything after 72 bytes
const within72 = (v: string) => Buffer.byteLength(v, 'utf8') <= MAX_PASSWORD_BYTES;
const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .refine(within72, `Password must be at most ${MAX_PASSWORD_BYTES} bytes`);
const token = z.string().min(1).max(200);

const loginBody = z.object({ login: z.string().max(64), password: z.string().max(MAX_PASSWORD_BYTES) });
const acceptBody = z.object({
  token,
  login: z
    .string()
    .trim()
    .toLowerCase()
    .regex(LOGIN_PATTERN, 'Login must be 3-64 characters: a-z, 0-9, ".", "_" or "-"'),
  name: z.string().trim().min(1, 'Name is required').max(64, 'Name must be at most 64 characters'),
  password,
  timeZone: z.string().max(64).optional(),
});
const resetBody = z.object({ token, password });

function validTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

type UserRow = { id: number; login: string; name: string; role: 'learner' | 'admin'; time_zone: string; password_hash: string };

const publicUser = (u: { id: number; login: string; name: string; role: 'learner' | 'admin'; time_zone: string }): AuthUser => ({
  id: u.id,
  login: u.login,
  name: u.name,
  role: u.role,
  timeZone: u.time_zone,
});

export function authRouter(deps: AppDeps): Router {
  const { db, now } = deps;
  const cost = deps.bcryptCost ?? 12;
  const router = Router();
  // Compared against when the login is unknown or inactive, so timing does not reveal which logins exist.
  const dummyHash = bcrypt.hashSync('not-a-real-password', cost);
  const failures = new Map<string, { count: number; firstAt: number }>();

  // Per-IP limiters use express-rate-limit's real clock (accepted exception to the deps.now() rule).
  const makeLimiter = () =>
    rateLimit({
      windowMs: WINDOW_MS,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({ error: 'Too many attempts. Try again later.' });
      },
    });
  const ipLimiter = makeLimiter();
  const inviteLimiter = makeLimiter(); // shared by accept-invite and reset

  /** Cheap token check done before any bcrypt work; the locked transaction re-checks it. */
  async function checkToken(raw: string, purpose: 'invite' | 'reset', t: Date) {
    const invite = await findInvite(db, hashToken(raw));
    if (!invite || invite.purpose !== purpose) return { status: 404, error: 'Link not found' };
    if (invite.used_at || invite.expires_at.getTime() <= t.getTime()) {
      return { status: 410, error: 'This link has already been used or has expired' };
    }
    return undefined;
  }

  router.post('/login', ipLimiter, validate(loginBody), async (req: Request, res: Response) => {
    const login = String(req.body.login).trim().toLowerCase();
    const t = now();
    const nowMs = t.getTime();

    let entry = failures.get(login);
    if (entry && nowMs - entry.firstAt >= WINDOW_MS) {
      failures.delete(login);
      entry = undefined;
    }
    if (entry && entry.count >= MAX_FAILURES) {
      res.status(429).json({ error: 'Too many attempts. Try again later.' });
      return;
    }

    await db.exec('DELETE FROM sessions WHERE expires_at < ?', [t]);
    await db.exec('DELETE FROM invites WHERE expires_at < ?', [new Date(nowMs - INVITE_KEEP_MS)]);

    const rows = await db.query<UserRow & { active: number }>(
      'SELECT id, login, name, role, time_zone, password_hash, active FROM users WHERE login = ?',
      [login],
    );
    const user = rows[0];
    const usable = user && user.active === 1 ? user : undefined;
    const ok = await bcrypt.compare(String(req.body.password), usable ? usable.password_hash : dummyHash);

    if (!usable || !ok) {
      for (const [k, v] of failures) if (nowMs - v.firstAt >= WINDOW_MS) failures.delete(k);
      const cur = failures.get(login);
      failures.set(login, cur ? { ...cur, count: cur.count + 1 } : { count: 1, firstAt: nowMs });
      res.status(401).json({ error: 'Invalid login or password' });
      return;
    }
    failures.delete(login);
    await startSession(req, res, usable.id);
    res.json({ user: publicUser(usable) });
  });

  router.post('/logout', async (req, res) => {
    const sid = readSessionCookie(req);
    if (sid) await db.exec('DELETE FROM sessions WHERE id_hash = ?', [hashToken(sid)]);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, async (req, res) => {
    res.json({ user: await loadAccountUser(db, req.user!.id) });
  });

  router.get('/invite/:token', async (req, res) => {
    const invite = await findInvite(db, hashToken(req.params.token));
    if (!invite) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }
    if (invite.used_at || invite.expires_at.getTime() <= now().getTime()) {
      res.status(410).json({ error: 'This link has already been used or has expired' });
      return;
    }
    if (invite.purpose === 'reset' && invite.user_id) {
      const rows = await db.query<{ name: string }>('SELECT name FROM users WHERE id = ?', [invite.user_id]);
      res.json({ purpose: 'reset', name: rows[0]?.name });
      return;
    }
    res.json({ purpose: invite.purpose });
  });

  router.post('/accept-invite', inviteLimiter, validate(acceptBody), async (req, res) => {
    const { token: raw, login, name, password: pw, timeZone } = req.body as z.infer<typeof acceptBody>;
    const t = now();
    const early = await checkToken(raw, 'invite', t);
    if (early) {
      res.status(early.status).json({ error: early.error });
      return;
    }
    const passwordHash = await bcrypt.hash(pw, cost);
    type Result = { status: number; error: string } | { userId: number };
    let result: Result;
    try {
      result = await db.tx<Result>(async (tx) => {
        const invite = await findInvite(tx, hashToken(raw), true);
        if (!invite || invite.purpose !== 'invite') return { status: 404, error: 'Invite not found' };
        if (invite.used_at || invite.expires_at.getTime() <= t.getTime()) {
          return { status: 410, error: 'This link has already been used or has expired' };
        }
        const taken = await tx.query('SELECT id FROM users WHERE login = ?', [login]);
        if (taken.length) return { status: 409, error: 'That login is already taken' };
        const created = await tx.exec(
          "INSERT INTO users (login, name, password_hash, role, time_zone, active, created_at) VALUES (?, ?, ?, 'learner', ?, 1, ?)",
          [login, name, passwordHash, validTimeZone(timeZone), t],
        );
        await tx.exec('UPDATE invites SET used_at = ?, user_id = ? WHERE id = ?', [t, created.insertId, invite.id]);
        return { userId: created.insertId };
      });
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') {
        res.status(409).json({ error: 'That login is already taken' });
        return;
      }
      throw err;
    }
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    await startSession(req, res, result.userId);
    const rows = await db.query<UserRow>('SELECT id, login, name, role, time_zone, password_hash FROM users WHERE id = ?', [
      result.userId,
    ]);
    res.json({ user: publicUser(rows[0]!) });
  });

  router.post('/reset', inviteLimiter, validate(resetBody), async (req, res) => {
    const { token: raw, password: pw } = req.body as z.infer<typeof resetBody>;
    const t = now();
    const early = await checkToken(raw, 'reset', t);
    if (early) {
      res.status(early.status).json({ error: early.error });
      return;
    }
    const passwordHash = await bcrypt.hash(pw, cost);
    const result = await db.tx<{ status: number; error: string } | { ok: true }>(async (tx) => {
      const invite = await findInvite(tx, hashToken(raw), true);
      if (!invite || invite.purpose !== 'reset' || !invite.user_id) return { status: 404, error: 'Reset link not found' };
      if (invite.used_at || invite.expires_at.getTime() <= t.getTime()) {
        return { status: 410, error: 'This link has already been used or has expired' };
      }
      const target = await tx.query('SELECT id FROM users WHERE id = ? AND active = 1', [invite.user_id]);
      if (!target.length) return { status: 404, error: 'Reset link not found' };
      await tx.exec('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, invite.user_id]);
      await tx.exec('UPDATE invites SET used_at = ? WHERE id = ?', [t, invite.id]);
      await tx.exec('DELETE FROM sessions WHERE user_id = ?', [invite.user_id]);
      return { ok: true };
    });
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
