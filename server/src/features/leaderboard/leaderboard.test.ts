import { expect, test } from 'vitest';
import type { Db } from '../../db/db.js';
import { createUser, loginAs, testApp } from '../../test/helpers.js';

const now = new Date('2026-11-12T12:00:00Z'); // Thursday; the week started Monday 2026-11-09 00:00 UTC

async function setup() {
  const t = await testApp({ now: () => now });
  return t;
}

let seq = 0;
async function xp(db: Db, userId: number, amount: number, at: string) {
  seq += 1;
  await db.exec('INSERT INTO xp_events (user_id, amount, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)', [
    userId,
    amount,
    'seed',
    `r${seq}`,
    new Date(at),
  ]);
}

test('all-time ranks by total XP descending', async () => {
  const { app, db } = await setup();
  const a = await createUser(db, { name: 'Ann' });
  const b = await createUser(db, { name: 'Bob' });
  const c = await createUser(db, { name: 'Cy' });
  await xp(db, a.id, 50, '2026-01-01T00:00:00Z');
  await xp(db, b.id, 300, '2026-02-01T00:00:00Z');
  await xp(db, c.id, 120, '2026-03-01T00:00:00Z');
  const agent = await loginAs(app, a);
  const res = await agent.get('/api/leaderboard?period=all');
  expect(res.status).toBe(200);
  expect(res.body.period).toBe('all');
  expect(res.body.rows.map((r: any) => [r.rank, r.name, r.xp, r.isMe])).toEqual([
    [1, 'Bob', 300, false],
    [2, 'Cy', 120, false],
    [3, 'Ann', 50, true],
  ]);
  expect(res.body.rows[0].level).toBe(2);
  expect(res.body.me).toEqual({ rank: 3, xp: 50 });
});

test('week counts only events since Monday 00:00 UTC (Sunday 23:59:59 excluded, Monday 00:00:00 included)', async () => {
  const { app, db } = await setup();
  const a = await createUser(db, { name: 'Ann' });
  const b = await createUser(db, { name: 'Bob' });
  const c = await createUser(db, { name: 'Cy' });
  await xp(db, a.id, 100, '2026-11-08T23:59:59Z'); // Sunday: excluded
  await xp(db, b.id, 40, '2026-11-09T00:00:00Z'); // Monday: included
  await xp(db, c.id, 10, '2026-11-11T00:00:00Z');
  await xp(db, c.id, 500, '2026-10-01T00:00:00Z'); // old; counts for level only
  const agent = await loginAs(app, a);
  const res = await agent.get('/api/leaderboard?period=week');
  expect(res.body.rows.map((r: any) => [r.name, r.xp])).toEqual([
    ['Bob', 40],
    ['Cy', 10],
  ]);
  expect(res.body.rows[1].level).toBe(1 + Math.floor(Math.sqrt(510 / 100))); // level is all-time
  expect(res.body.me).toBeNull(); // Ann has no XP this week
});

test('tie: the learner whose latest event is earlier ranks higher', async () => {
  const { app, db } = await setup();
  const a = await createUser(db, { name: 'Late' });
  const b = await createUser(db, { name: 'Early' });
  await xp(db, a.id, 60, '2026-11-11T10:00:00Z');
  await xp(db, b.id, 30, '2026-11-09T10:00:00Z');
  await xp(db, b.id, 30, '2026-11-10T10:00:00Z');
  const agent = await loginAs(app, a);
  const res = await agent.get('/api/leaderboard?period=all');
  expect(res.body.rows.map((r: any) => r.name)).toEqual(['Early', 'Late']);
});

test('hidden and deactivated learners are absent; a hidden viewer still gets rows and me === null', async () => {
  const { app, db } = await setup();
  const viewer = await createUser(db, { name: 'Hidden Viewer' });
  const shown = await createUser(db, { name: 'Shown' });
  const gone = await createUser(db, { name: 'Gone', active: false });
  for (const u of [viewer, shown, gone]) await xp(db, u.id, 100, '2026-11-10T10:00:00Z');
  await db.exec('UPDATE users SET hide_from_leaderboard = 1 WHERE id = ?', [viewer.id]);
  const agent = await loginAs(app, viewer);
  const res = await agent.get('/api/leaderboard?period=all');
  expect(res.status).toBe(200);
  expect(res.body.rows.map((r: any) => r.name)).toEqual(['Shown']);
  expect(res.body.me).toBeNull();
});

test('rows contain exactly the keys rank, userId, name, level, xp, streak, isMe (no login, role, scores)', async () => {
  const { app, db } = await setup();
  const a = await createUser(db, { name: 'Ann', role: 'admin' });
  await xp(db, a.id, 10, '2026-11-12T08:00:00Z');
  await xp(db, a.id, 10, '2026-11-11T08:00:00Z');
  const agent = await loginAs(app, a);
  const res = await agent.get('/api/leaderboard?period=all');
  expect(res.body.rows).toHaveLength(1); // admins who study appear
  expect(Object.keys(res.body.rows[0]).sort()).toEqual(['isMe', 'level', 'name', 'rank', 'streak', 'userId', 'xp']);
  expect(res.body.rows[0].streak).toBe(2);
  expect(Object.keys(res.body).sort()).toEqual(['me', 'period', 'rows']);
});

test('streak uses each row\'s own time zone', async () => {
  const { app, db } = await setup();
  const viewer = await createUser(db, { name: 'V', timeZone: 'UTC' });
  const tokyo = await createUser(db, { name: 'Tokyo', timeZone: 'Asia/Tokyo' });
  // 12:00Z on the 12th is the 12th in Tokyo; 16:00Z on the 11th is 01:00 on the 12th in Tokyo,
  // so both events fall on the same Tokyo day but on two UTC days.
  await xp(db, tokyo.id, 10, '2026-11-11T16:00:00Z');
  await xp(db, tokyo.id, 10, '2026-11-12T01:00:00Z');
  await xp(db, viewer.id, 1, '2026-11-12T01:00:00Z');
  await xp(db, viewer.id, 1, '2026-11-11T16:00:00Z');
  const agent = await loginAs(app, viewer);
  const res = await agent.get('/api/leaderboard?period=all');
  const by = Object.fromEntries(res.body.rows.map((r: any) => [r.name, r.streak]));
  expect(by.Tokyo).toBe(1);
  expect(by.V).toBe(2);
});

test('viewer ranked 51st is not in rows but me.rank === 51', async () => {
  const { app, db } = await setup();
  const viewer = await createUser(db, { name: 'Viewer' });
  await xp(db, viewer.id, 1, '2026-11-10T00:00:00Z');
  for (let i = 0; i < 50; i++) {
    const u = await createUser(db, { name: `Other ${i}` });
    await xp(db, u.id, 100 + i, '2026-11-10T00:00:00Z');
  }
  const agent = await loginAs(app, viewer);
  const res = await agent.get('/api/leaderboard?period=all');
  expect(res.body.rows).toHaveLength(50);
  expect(res.body.rows.some((r: any) => r.isMe)).toBe(false);
  expect(res.body.me).toEqual({ rank: 51, xp: 1 });
});

test('invalid period -> 400; anonymous -> 401', async () => {
  const { app, db } = await setup();
  const a = await createUser(db);
  const agent = await loginAs(app, a);
  expect((await agent.get('/api/leaderboard?period=month')).status).toBe(400);
  expect((await agent.get('/api/leaderboard')).status).toBe(400);
  const { default: request } = await import('supertest');
  expect((await request(app).get('/api/leaderboard?period=all')).status).toBe(401);
});
