import bcrypt from 'bcryptjs';
import type { Db } from '../../db/db.js';
import type { Env } from '../../env.js';
import type { AuthUser } from '../../http.js';
import { newToken } from './tokens.js';

export const INVITE_DAYS = 7;
export const MIN_PASSWORD_LENGTH = 12;
/** bcrypt ignores everything after 72 bytes, so a longer password is refused wherever one is set or tried. */
export const MAX_PASSWORD_BYTES = 72;
export const passwordFits = (password: string): boolean => Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES;
export const BCRYPT_COST = 12;
export const LOGIN_PATTERN = /^[a-z0-9._-]{3,64}$/;

export type InviteRow = {
  id: number;
  purpose: 'invite' | 'reset';
  user_id: number | null;
  expires_at: Date;
  used_at: Date | null;
};

/** Creates an invite or reset token; only its hash is stored. Returns the plain token for the admin to share. */
export async function createInvite(
  db: Db,
  o: { purpose: 'invite' | 'reset'; userId?: number; createdBy: number; now: Date },
): Promise<string> {
  const { token, hash } = newToken();
  const expires = new Date(o.now.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  await db.exec('INSERT INTO invites (token_hash, purpose, user_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?)', [
    hash,
    o.purpose,
    o.userId ?? null,
    o.createdBy,
    expires,
  ]);
  return token;
}

export async function findInvite(db: Db, hash: string, forUpdate = false): Promise<InviteRow | undefined> {
  const rows = await db.query<InviteRow>(
    `SELECT id, purpose, user_id, expires_at, used_at FROM invites WHERE token_hash = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [hash],
  );
  return rows[0];
}

/** Bootstraps the first admin from env variables when no admin exists yet. */
export async function ensureAdmin(
  db: Db,
  env: Pick<Env, 'adminLogin' | 'adminPassword' | 'adminName'>,
  now: Date,
  cost = BCRYPT_COST,
): Promise<void> {
  const existing = await db.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (existing.length) return;
  const { adminLogin, adminPassword, adminName } = env;
  if (adminPassword && adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (adminPassword && !passwordFits(adminPassword)) {
    throw new Error(`ADMIN_PASSWORD must be at most ${MAX_PASSWORD_BYTES} bytes (UTF-8): sign-in refuses a longer one`);
  }
  if (!adminLogin || !adminPassword) {
    console.warn('No admin user exists and ADMIN_LOGIN/ADMIN_PASSWORD are not set; nobody can sign in.');
    return;
  }
  const login = adminLogin.trim().toLowerCase();
  if (!LOGIN_PATTERN.test(login)) throw new Error('ADMIN_LOGIN must be 3-64 characters of a-z, 0-9, ".", "_" or "-"');
  const hash = await bcrypt.hash(adminPassword, cost);
  await db.exec(
    "INSERT INTO users (login, name, password_hash, role, time_zone, active, created_at) VALUES (?, ?, ?, 'admin', 'UTC', 1, ?)",
    [login, (adminName?.trim() || login).slice(0, 64), hash, now],
  );
}

export type AccountUser = AuthUser & { examDate: string | null; hideFromLeaderboard: boolean };

/** The one user shape the client sees: `/api/auth/me` and the settings response. */
export async function loadAccountUser(db: Db, userId: number): Promise<AccountUser | undefined> {
  const [r] = await db.query<{
    id: number;
    login: string;
    name: string;
    role: 'learner' | 'admin';
    time_zone: string;
    exam_date: string | null;
    hide_from_leaderboard: number;
  }>('SELECT id, login, name, role, time_zone, exam_date, hide_from_leaderboard FROM users WHERE id = ?', [userId]);
  if (!r) return undefined;
  return {
    id: r.id,
    login: r.login,
    name: r.name,
    role: r.role,
    timeZone: r.time_zone,
    examDate: r.exam_date,
    hideFromLeaderboard: Boolean(r.hide_from_leaderboard),
  };
}
