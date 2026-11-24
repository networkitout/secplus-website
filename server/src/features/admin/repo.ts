import type { Db } from '../../db/db.js';

export type AdminUser = {
  id: number;
  login: string;
  name: string;
  role: 'learner' | 'admin';
  active: boolean;
  lastActiveAt: string | null;
  domainsPassed: number[];
  latestMockScore: number | null;
};

type UserRow = {
  id: number;
  login: string;
  name: string;
  role: 'learner' | 'admin';
  active: number;
  last_active_at: Date | null;
};

export async function listUsers(db: Db): Promise<AdminUser[]> {
  const users = await db.query<UserRow>(
    'SELECT id, login, name, role, active, last_active_at FROM users ORDER BY created_at, id',
  );
  const passed = await db.query<{ user_id: number; scope: string }>(
    "SELECT DISTINCT user_id, scope FROM assessments WHERE kind = 'domain' AND passed = 1 AND submitted_at IS NOT NULL AND scope IS NOT NULL",
  );
  const mocks = await db.query<{ user_id: number; scaled_score: number | null }>(
    `SELECT a.user_id, a.scaled_score FROM assessments a
      WHERE a.kind = 'mock' AND a.submitted_at IS NOT NULL
        AND a.id = (SELECT b.id FROM assessments b
                     WHERE b.user_id = a.user_id AND b.kind = 'mock' AND b.submitted_at IS NOT NULL
                     ORDER BY b.submitted_at DESC, b.id DESC LIMIT 1)`,
  );
  const domains = new Map<number, number[]>();
  for (const p of passed) {
    const n = Number(p.scope);
    if (!Number.isInteger(n)) continue;
    domains.set(p.user_id, [...(domains.get(p.user_id) ?? []), n]);
  }
  const latest = new Map(mocks.map((m) => [m.user_id, m.scaled_score]));
  return users.map((u) => ({
    id: u.id,
    login: u.login,
    name: u.name,
    role: u.role,
    active: u.active === 1,
    lastActiveAt: u.last_active_at ? u.last_active_at.toISOString() : null,
    domainsPassed: (domains.get(u.id) ?? []).sort((a, b) => a - b),
    latestMockScore: latest.get(u.id) ?? null,
  }));
}

export async function findActiveUserId(db: Db, id: number): Promise<boolean> {
  const rows = await db.query('SELECT id FROM users WHERE id = ? AND active = 1', [id]);
  return rows.length > 0;
}

/** Sets the active flag; deactivating also deletes the user's sessions. Returns false for an unknown user. */
export async function setActive(db: Db, id: number, active: boolean): Promise<boolean> {
  return db.tx(async (tx) => {
    const rows = await tx.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) return false;
    await tx.exec('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, id]);
    if (!active) await tx.exec('DELETE FROM sessions WHERE user_id = ?', [id]);
    return true;
  });
}
