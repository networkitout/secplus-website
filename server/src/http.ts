import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import type { AppDeps } from './app.js';
import { hashToken, newToken } from './features/auth/tokens.js';

/** Header every state-changing API request must carry (checked by the CSRF middleware, preset by test helpers). */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'secplus';

export const SESSION_COOKIE = 'sid';
export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60_000;

export type AuthUser = { id: number; login: string; name: string; role: 'learner' | 'admin'; timeZone: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
    interface Locals {
      deps: AppDeps;
    }
  }
}

function depsOf(req: Request): AppDeps {
  return req.app.locals.deps as AppDeps;
}

/** Validates `req.body` with Zod; replaces it with the parsed value, or answers 400 `{error}`. */
export function validate<T>(schema: ZodType<T>): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
      return;
    }
    req.body = parsed.data;
    next();
  };
}

export function requireCsrfHeader(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.get(CSRF_HEADER) !== CSRF_VALUE) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function cookieOptions(deps: AppDeps, expires: Date) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: deps.secureCookies, path: '/', expires };
}

export function clearSessionCookie(req: Request, res: Response): void {
  const deps = depsOf(req);
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: deps.secureCookies, path: '/' });
}

/** Creates a session row for the user and sets the `sid` cookie. */
export async function startSession(req: Request, res: Response, userId: number): Promise<void> {
  const deps = depsOf(req);
  const { token, hash } = newToken();
  const expires = new Date(deps.now().getTime() + SESSION_DAYS * DAY_MS);
  await deps.db.exec('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)', [hash, userId, expires]);
  res.cookie(SESSION_COOKIE, token, cookieOptions(deps, expires));
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const deps = depsOf(req);
    const sid = readSessionCookie(req);
    if (!sid) {
      res.status(401).json({ error: 'Not signed in' });
      return;
    }
    const idHash = hashToken(sid);
    const now = deps.now();
    const rows = await deps.db.query<{
      id: number;
      login: string;
      name: string;
      role: 'learner' | 'admin';
      time_zone: string;
      last_active_at: Date | null;
    }>(
      `SELECT u.id, u.login, u.name, u.role, u.time_zone, u.last_active_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id_hash = ? AND s.expires_at > ? AND u.active = 1`,
      [idHash, now],
    );
    const row = rows[0];
    if (!row) {
      res.status(401).json({ error: 'Not signed in' });
      return;
    }
    if (!row.last_active_at || now.getTime() - row.last_active_at.getTime() >= TOUCH_INTERVAL_MS) {
      const expires = new Date(now.getTime() + SESSION_DAYS * DAY_MS);
      await deps.db.exec('UPDATE users SET last_active_at = ? WHERE id = ?', [now, row.id]);
      await deps.db.exec('UPDATE sessions SET expires_at = ? WHERE id_hash = ?', [expires, idHash]);
      res.cookie(SESSION_COOKIE, sid, cookieOptions(deps, expires));
    }
    req.user = { id: row.id, login: row.login, name: row.name, role: row.role, timeZone: row.time_zone };
    next();
  } catch (err) {
    next(err);
  }
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
};
