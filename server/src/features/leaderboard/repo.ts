import type { Db } from '../../db/db.js';
import { safeTimeZone, weekStartUtc } from '../../services/time.js';
import { totals } from '../xp/repo.js';

export const LEADERBOARD_SIZE = 50;

export type Period = 'week' | 'all';
export type LeaderboardRow = {
  rank: number;
  userId: number;
  name: string;
  level: number;
  xp: number;
  streak: number;
  isMe: boolean;
};
export type Leaderboard = { period: Period; rows: LeaderboardRow[]; me: { rank: number; xp: number } | null };

type Standing = { id: number; name: string; time_zone: string; xp: string | number; last_at: Date };

/**
 * Visible learners with XP in the period, best first: most XP, then whoever reached it first (earliest
 * latest-event), then lowest id. Hidden and deactivated learners are excluded.
 */
async function standings(db: Db, period: Period, now: Date): Promise<Standing[]> {
  const since = period === 'week' ? weekStartUtc(now) : undefined;
  return db.query<Standing>(
    `SELECT u.id, u.name, u.time_zone, SUM(e.amount) AS xp, MAX(e.created_at) AS last_at
       FROM users u JOIN xp_events e ON e.user_id = u.id
      WHERE u.active = 1 AND u.hide_from_leaderboard = 0${since ? ' AND e.created_at >= ?' : ''}
      GROUP BY u.id, u.name, u.time_zone
     HAVING SUM(e.amount) > 0
      ORDER BY xp DESC, last_at ASC, u.id ASC`,
    since ? [since] : [],
  );
}

export async function leaderboard(db: Db, viewerId: number, period: Period, now: Date): Promise<Leaderboard> {
  const ranked = await standings(db, period, now);
  const top = ranked.slice(0, LEADERBOARD_SIZE);

  const rows: LeaderboardRow[] = [];
  for (const [i, s] of top.entries()) {
    // Level is always from all-time XP; the streak is computed in the learner's own time zone.
    const t = await totals(db, s.id, safeTimeZone(s.time_zone), now);
    rows.push({
      rank: i + 1,
      userId: s.id,
      name: s.name,
      level: t.level,
      xp: Number(s.xp),
      streak: t.streak,
      isMe: s.id === viewerId,
    });
  }

  const idx = ranked.findIndex((s) => s.id === viewerId);
  const me = idx === -1 ? null : { rank: idx + 1, xp: Number(ranked[idx]!.xp) };
  return { period, rows, me };
}
