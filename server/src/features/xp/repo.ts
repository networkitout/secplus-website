import type { Db } from '../../db/db.js';
import { logError } from '../../log.js';
import { localDate, safeTimeZone, streak } from '../../services/time.js';
import { levelForXp } from '../../services/xp.js';

const STREAK_WINDOW_DAYS = 400;
const STREAK_BADGES = [
  { id: 'streak-3', days: 3 },
  { id: 'streak-7', days: 7 },
  { id: 'streak-30', days: 30 },
];

export async function awardXp(
  db: Db,
  e: { userId: number; amount: number; reason: string; ref: string; now: Date },
): Promise<boolean> {
  const res = await db.exec(
    'INSERT IGNORE INTO xp_events (user_id, amount, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)',
    [e.userId, e.amount, e.reason, e.ref, e.now],
  );
  return res.affectedRows === 1;
}

async function currentStreak(db: Db, userId: number, tz: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - STREAK_WINDOW_DAYS * 86_400_000);
  const rows = await db.query<{ created_at: Date }>(
    'SELECT created_at FROM xp_events WHERE user_id = ? AND created_at >= ? AND created_at <= ?',
    [userId, since, now],
  );
  const dates = rows.map((r) => localDate(new Date(r.created_at), tz));
  return streak(dates, localDate(now, tz));
}

export async function totals(
  db: Db,
  userId: number,
  tz: string,
  now: Date,
): Promise<{ xp: number; level: number; streak: number }> {
  const zone = safeTimeZone(tz);
  const [row] = await db.query<{ xp: string | number | null }>(
    'SELECT COALESCE(SUM(amount), 0) AS xp FROM xp_events WHERE user_id = ?',
    [userId],
  );
  const xp = Number(row?.xp ?? 0);
  return { xp, level: levelForXp(xp), streak: await currentStreak(db, userId, zone, now) };
}

async function exists(db: Db, sql: string, params: unknown[]): Promise<boolean> {
  const rows = await db.query(sql + ' LIMIT 1', params);
  return rows.length > 0;
}

/** Awards any newly earned badges and returns only the ids inserted by this call. */
export async function evaluateBadges(db: Db, userId: number, tz: string, now: Date): Promise<string[]> {
  const zone = safeTimeZone(tz);
  const held = new Set(
    (await db.query<{ badge_id: string }>('SELECT badge_id FROM badges WHERE user_id = ?', [userId])).map(
      (r) => r.badge_id,
    ),
  );
  const earned: string[] = [];
  const check = async (id: string, test: () => Promise<boolean> | boolean) => {
    if (!held.has(id) && (await test())) earned.push(id);
  };
  const passed = (kind: string, scope?: string) =>
    exists(
      db,
      `SELECT 1 FROM assessments WHERE user_id = ? AND kind = ? AND passed = 1${scope === undefined ? '' : ' AND scope = ?'}`,
      scope === undefined ? [userId, kind] : [userId, kind, scope],
    );

  await check('first-lesson', () =>
    exists(db, 'SELECT 1 FROM lesson_progress WHERE user_id = ? AND completed_at IS NOT NULL', [userId]),
  );
  await check('first-quiz-pass', () => passed('objective'));
  await check('first-mock-pass', () => passed('mock'));
  await check('domain-1-complete', () => passed('domain', '1'));

  // The streak reads every XP event of the window; skip it once there is no streak badge left to earn.
  if (STREAK_BADGES.some((b) => !held.has(b.id))) {
    const current = await currentStreak(db, userId, zone, now);
    for (const b of STREAK_BADGES) await check(b.id, () => current >= b.days);
  }

  await check('hundred-correct', async () => {
    const [r] = await db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM attempts WHERE user_id = ? AND correct = 1',
      [userId],
    );
    return Number(r.n) >= 100;
  });
  await check('lab-rat', async () => {
    const [r] = await db.query<{ n: number }>(
      'SELECT COUNT(DISTINCT lab_id) AS n FROM lab_results WHERE user_id = ? AND passed = 1',
      [userId],
    );
    return Number(r.n) >= 3;
  });

  const inserted: string[] = [];
  for (const id of earned) {
    const res = await db.exec('INSERT IGNORE INTO badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)', [
      userId,
      id,
      now,
    ]);
    if (res.affectedRows === 1) inserted.push(id);
  }
  return inserted;
}

/**
 * `evaluateBadges` for a request whose writes are already committed. Failing the request now would have the
 * client repeat what is recorded, so a failure is logged and reported as no new badges; the next evaluation
 * awards whatever this one missed. Never inside a transaction: an error there must roll it back.
 */
export async function evaluateBadgesAfterCommit(db: Db, userId: number, tz: string, now: Date): Promise<string[]> {
  try {
    return await evaluateBadges(db, userId, tz, now);
  } catch (err) {
    logError(err, `Badge evaluation failed for user ${userId}`);
    return [];
  }
}
