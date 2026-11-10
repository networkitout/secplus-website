import bcrypt from 'bcryptjs';
import type { Db } from '../../db/db.js';
import type { Env } from '../../env.js';
import { newToken } from './tokens.js';

export const INVITE_DAYS = 7;
export const MIN_PASSWORD_LENGTH = 12;
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
  if (!adminLogin || !adminPassword) {
    console.warn('No admin user exists and ADMIN_LOGIN/ADMIN_PASSWORD are not set; nobody can sign in.');
    return;
  }
  if (adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const login = adminLogin.trim().toLowerCase();
  if (!LOGIN_PATTERN.test(login)) throw new Error('ADMIN_LOGIN must be 3-64 characters of a-z, 0-9, ".", "_" or "-"');
  const hash = await bcrypt.hash(adminPassword, cost);
  await db.exec(
    "INSERT INTO users (login, name, password_hash, role, time_zone, active, created_at) VALUES (?, ?, ?, 'admin', 'UTC', 1, ?)",
    [login, (adminName?.trim() || login).slice(0, 64), hash, now],
  );
}
