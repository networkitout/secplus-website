import { expect, test } from 'vitest';
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
  await event(db, userId, '2026-11-10T03:00:00Z', 'a');
  await event(db, userId, '2026-11-11T03:00:00Z', 'b');
  expect((await totals(db, userId, 'UTC', now)).streak).toBe(2);
  expect((await totals(db, userId, 'America/Chicago', now)).streak).toBe(2);
  // Chicago days are Nov 9 and Nov 10; as of Nov 12 04:00Z (Nov 11 local) the streak is still alive, UTC's is not.
  const later = new Date('2026-11-13T04:00:00Z');
  expect((await totals(db, userId, 'America/Chicago', later)).streak).toBe(0);
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
