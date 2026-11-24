import { expect, test, vi } from 'vitest';
import type { Db } from '../../db/db.js';
import { createUser, testApp } from '../../test/helpers.js';
import { awardXp, evaluateBadges, totals } from './repo.js';

const now = new Date('2026-11-11T04:00:00Z');

async function setup(timeZone = 'UTC') {
  const t = await testApp({ now: () => now });
  const user = await createUser(t.db, { timeZone });
  return { db: t.db, userId: user.id };
}

async function event(db: Db, userId: number, at: string, ref: string, amount = 10) {
  await db.exec('INSERT INTO xp_events (user_id, amount, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)',
    [userId, amount, 'test', ref, new Date(at)]);
}

async function assessment(db: Db, userId: number, kind: string, scope: string | null, passed: boolean) {
  await db.exec(
    `INSERT INTO assessments (user_id, kind, scope, question_ids, answers, flags, started_at, submitted_at, passed)
     VALUES (?, ?, ?, '[]', '{}', '[]', ?, ?, ?)`,
    [userId, kind, scope, now, now, passed ? 1 : 0]);
}

test('awardXp is idempotent per (user, reason, ref)', async () => {
  const { db, userId } = await setup();
  expect(await awardXp(db, { userId, amount: 50, reason: 'lesson', ref: '1.1', now })).toBe(true);
  expect(await awardXp(db, { userId, amount: 50, reason: 'lesson', ref: '1.1', now })).toBe(false);
  expect((await totals(db, userId, 'UTC', now)).xp).toBe(50);
});

test('totals reports level and tolerates a bad time zone', async () => {
  const { db, userId } = await setup();
  await awardXp(db, { userId, amount: 150, reason: 'lesson', ref: '1.1', now });
  expect(await totals(db, userId, 'Mars/Olympus', now)).toEqual({ xp: 150, level: 2, streak: 1 });
});

test('totals streak uses the user time zone', async () => {
  const { db, userId } = await setup();
  await event(db, userId, '2026-11-09T23:00:00Z', 'a');
  await event(db, userId, '2026-11-10T03:00:00Z', 'b');
  const at = new Date('2026-11-10T05:00:00Z');
  expect((await totals(db, userId, 'UTC', at)).streak).toBe(2);
  expect((await totals(db, userId, 'America/Chicago', at)).streak).toBe(1); // both events are Nov 9 in Chicago
  expect((await totals(db, userId, 'Mars/Olympus', at)).streak).toBe(2); // invalid zone behaves as UTC
});

test('evaluateBadges streak-7 threshold', async () => {
  const { db, userId } = await setup();
  for (let d = 5; d <= 10; d++) await event(db, userId, `2026-11-${String(d).padStart(2, '0')}T10:00:00Z`, `d${d}`);
  expect(await evaluateBadges(db, userId, 'UTC', now)).toEqual(['streak-3']); // 6 days (Nov 5-10), now is Nov 11 04:00Z
  await event(db, userId, '2026-11-11T01:00:00Z', 'd11');
  expect(await evaluateBadges(db, userId, 'UTC', now)).toEqual(['streak-7']);
});

test('evaluateBadges returns each badge once', async () => {
  const { db, userId } = await setup();
  await event(db, userId, '2026-11-09T10:00:00Z', 'a');
  await event(db, userId, '2026-11-10T10:00:00Z', 'b');
  await event(db, userId, '2026-11-11T01:00:00Z', 'c');
  expect(await evaluateBadges(db, userId, 'UTC', now)).toEqual(['streak-3']);
  expect(await evaluateBadges(db, userId, 'UTC', now)).toEqual([]);
  const rows = await db.query('SELECT badge_id FROM badges WHERE user_id = ?', [userId]);
  expect(rows).toHaveLength(1);
});

test('evaluateBadges: lesson, assessments, labs and correct answers', async () => {
  const { db, userId } = await setup();
  expect(await evaluateBadges(db, userId, 'UTC', now)).toEqual([]);

  await db.exec("INSERT INTO lesson_progress (user_id, objective, sections_done) VALUES (?, '1.1', '[]')", [userId]);
  expect(await evaluateBadges(db, userId, 'UTC', now)).toEqual([]); // not completed
  await db.exec("UPDATE lesson_progress SET completed_at = ? WHERE user_id = ?", [now, userId]);

  await assessment(db, userId, 'objective', '1.1', false);
  await assessment(db, userId, 'domain', '2', true);
  await assessment(db, userId, 'domain', '1', true);
  await assessment(db, userId, 'mock', null, true);
  for (const lab of ['a', 'a', 'b', 'c']) {
    await db.exec('INSERT INTO lab_results (user_id, lab_id, score_pct, passed) VALUES (?, ?, 100, 1)', [userId, lab]);
  }
  for (let i = 0; i < 100; i++) {
    await db.exec("INSERT INTO attempts (user_id, question_id, correct, context) VALUES (?, ?, 1, 'quiz')", [userId, `q${i}`]);
  }
  const got = await evaluateBadges(db, userId, 'UTC', now);
  expect(got.sort()).toEqual(['domain-1-complete', 'first-lesson', 'first-mock-pass', 'hundred-correct', 'lab-rat']);

  await assessment(db, userId, 'objective', '1.2', true);
  expect(await evaluateBadges(db, userId, 'UTC', now)).toEqual(['first-quiz-pass']);
});

test('evaluateBadges reads the XP events for the streak only while a streak badge is still to be earned', async () => {
  const { db, userId } = await setup();
  for (let d = 9; d <= 11; d++) await event(db, userId, `2026-11-${String(d).padStart(2, '0')}T01:00:00Z`, `d${d}`);
  const streakReads = async () => {
    const spy = vi.spyOn(db, 'query');
    try {
      const earned = await evaluateBadges(db, userId, 'UTC', now);
      return { earned, reads: spy.mock.calls.filter(([sql]) => /FROM xp_events/.test(String(sql))).length };
    } finally {
      spy.mockRestore();
    }
  };
  expect(await streakReads()).toEqual({ earned: ['streak-3'], reads: 1 });
  expect(await streakReads()).toEqual({ earned: [], reads: 1 }); // streak-7 and streak-30 are still open
  for (const id of ['streak-7', 'streak-30']) {
    await db.exec('INSERT INTO badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)', [userId, id, now]);
  }
  expect(await streakReads()).toEqual({ earned: [], reads: 0 });
});
