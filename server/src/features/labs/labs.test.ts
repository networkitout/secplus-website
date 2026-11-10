import { expect, test } from 'vitest';
import type { Answer } from '../../../../shared/types.js';
import { createUser, loginAs, testApp } from '../../test/helpers.js';
import { labPassed } from './repo.js';

const now = new Date('2026-11-10T12:00:00Z');

async function setup(opts: { lessonDone?: boolean } = {}) {
  const t = await testApp({ now: () => now });
  const user = await createUser(t.db);
  const agent = await loginAs(t.app, user);
  if (opts.lessonDone !== false) await completeLesson(t.db, user.id, '1.1');
  return { ...t, user, agent };
}

async function completeLesson(db: Awaited<ReturnType<typeof testApp>>['db'], userId: number, objective: string) {
  await db.exec(
    "INSERT INTO lesson_progress (user_id, objective, sections_done, completed_at) VALUES (?, ?, '[]', ?)",
    [userId, objective, now],
  );
}

const RIGHT: Record<string, Answer> = {
  'lab-1-01-s1': { type: 'single', choice: 'b' },
  'lab-1-01-s2': { type: 'multi', choices: ['a', 'c'] },
  'lab-1-01-s3': { type: 'order', order: ['i2', 'i1', 'i4', 'i3'] },
  'lab-1-01-s4': { type: 'match', pairs: { l1: 'r2', l2: 'r3', l3: 'r1' } },
  'lab-1-01-s5': { type: 'categorize', placements: { t1: 'x', t2: 'y', t3: 'x', t4: 'y' } },
};
const STEP_XP = 10 * (1 + 2 + 3 + 1 + 2); // first-correct XP across the five steps

test("list marks a lab unavailable until its objectives' lessons are complete; GET/submit on it return 403", async () => {
  const { agent, db, user } = await setup({ lessonDone: false });
  let list = await agent.get('/api/labs');
  expect(list.status).toBe(200);
  expect(list.body.labs).toEqual([
    { id: 'lab-1-01', domain: 1, title: 'Fixture lab', objectives: ['1.1'], available: false, bestScore: null, passed: false },
  ]);
  expect((await agent.get('/api/labs/lab-1-01')).status).toBe(403);
  expect((await agent.post('/api/labs/lab-1-01/submit').send({ answers: RIGHT })).status).toBe(403);
  expect(await db.query('SELECT 1 FROM lab_results')).toHaveLength(0);
  await completeLesson(db, user.id, '1.1');
  list = await agent.get('/api/labs');
  expect(list.body.labs[0].available).toBe(true);
});

test('a lab in a locked domain is unavailable even with its lessons done', async () => {
  const { agent, content } = await setup();
  content.labs.get('lab-1-01')!.domain = 2;
  try {
    expect((await agent.get('/api/labs')).body.labs[0].available).toBe(false);
    expect((await agent.get('/api/labs/lab-1-01')).status).toBe(403);
  } finally {
    content.labs.get('lab-1-01')!.domain = 1;
  }
});

test('unknown lab id is 404 on GET and submit; anonymous is 401', async () => {
  const { agent, app } = await setup();
  expect((await agent.get('/api/labs/nope')).status).toBe(404);
  expect((await agent.post('/api/labs/nope/submit').send({ answers: {} })).status).toBe(404);
  const { default: request } = await import('supertest');
  expect((await request(app).get('/api/labs')).status).toBe(401);
});

test('GET returns steps with no answer data', async () => {
  const { agent } = await setup();
  const res = await agent.get('/api/labs/lab-1-01');
  expect(res.status).toBe(200);
  expect(res.body.id).toBe('lab-1-01');
  expect(res.body.scenario).toBe('A fixture scenario.');
  expect(res.body.steps.map((s: any) => s.id)).toEqual(['lab-1-01-s1', 'lab-1-01-s2', 'lab-1-01-s3', 'lab-1-01-s4', 'lab-1-01-s5']);
  expect(JSON.stringify(res.body)).not.toMatch(/"(correct|explanation|why)"/);
  const again = await agent.get('/api/labs/lab-1-01');
  expect(again.body.steps).toEqual(res.body.steps); // stable per learner
});

test('all steps correct: 100, passed, lab_results row; resubmitting awards no second pass bonus and bestScore stays 100', async () => {
  const { agent, db, user } = await setup();
  const res = await agent.post('/api/labs/lab-1-01/submit').send({ answers: RIGHT });
  expect(res.status).toBe(200);
  expect(res.body.scorePct).toBe(100);
  expect(res.body.passed).toBe(true);
  expect(res.body.xp).toBe(STEP_XP + 75);
  expect(Object.keys(res.body.steps)).toHaveLength(5);
  expect(res.body.steps['lab-1-01-s1'].correct).toBe(true);
  expect(res.body.newBadges).not.toContain('lab-rat');
  const bonus = await db.query("SELECT amount FROM xp_events WHERE user_id = ? AND reason = 'lab-pass'", [user.id]);
  expect(bonus).toEqual([{ amount: 75 }]);
  const attempts = await db.query("SELECT context FROM attempts WHERE user_id = ? AND context = 'lab'", [user.id]);
  expect(attempts).toHaveLength(5);

  const again = await agent.post('/api/labs/lab-1-01/submit').send({ answers: RIGHT });
  expect(again.body.scorePct).toBe(100);
  expect(again.body.xp).toBe(5 * 2); // only the same-day repeat-correct XP; no second 75
  expect(await db.query("SELECT 1 FROM xp_events WHERE user_id = ? AND reason = 'lab-pass'", [user.id])).toHaveLength(1);
  expect(await db.query('SELECT 1 FROM lab_results WHERE user_id = ?', [user.id])).toHaveLength(2);
  const list = await agent.get('/api/labs');
  expect(list.body.labs[0]).toMatchObject({ bestScore: 100, passed: true });
});

test('partial credit: 4 of 5 steps fully right and the order step half right scores 90', async () => {
  const { agent, db, user } = await setup();
  const answers = { ...RIGHT, 'lab-1-01-s3': { type: 'order', order: ['i1', 'i2', 'i4', 'i3'] } }; // fraction 0.5
  const res = await agent.post('/api/labs/lab-1-01/submit').send({ answers });
  expect(res.status).toBe(200);
  expect(res.body.scorePct).toBe(90);
  expect(res.body.passed).toBe(true);
  expect(res.body.steps['lab-1-01-s3']).toMatchObject({ correct: false, fraction: 0.5 });
  const [row] = await db.query('SELECT score_pct, passed FROM lab_results WHERE user_id = ?', [user.id]);
  expect(Number(row.score_pct)).toBe(90);
});

test('score 79.9 fails, 80 passes', () => {
  expect(labPassed(79.9)).toBe(false);
  expect(labPassed(80)).toBe(true);
});

test('a failing submit awards no pass bonus and records bestScore as the max over results', async () => {
  const { agent, db, user } = await setup();
  const res = await agent.post('/api/labs/lab-1-01/submit').send({ answers: { 'lab-1-01-s1': RIGHT['lab-1-01-s1'] } });
  expect(res.body.scorePct).toBe(20);
  expect(res.body.passed).toBe(false);
  expect(res.body.xp).toBe(10);
  expect(await db.query("SELECT 1 FROM xp_events WHERE user_id = ? AND reason = 'lab-pass'", [user.id])).toHaveLength(0);
  await agent.post('/api/labs/lab-1-01/submit').send({ answers: RIGHT });
  await agent.post('/api/labs/lab-1-01/submit').send({ answers: {} });
  const list = await agent.get('/api/labs');
  expect(list.body.labs[0]).toMatchObject({ bestScore: 100, passed: true });
});

test('missing step answers score 0 for that step; an answer keyed to an unknown step id is 400', async () => {
  const { agent, db, user } = await setup();
  const { 'lab-1-01-s5': _omit, ...four } = RIGHT;
  void _omit;
  const res = await agent.post('/api/labs/lab-1-01/submit').send({ answers: four });
  expect(res.status).toBe(200);
  expect(res.body.scorePct).toBe(80);
  expect(res.body.steps['lab-1-01-s5']).toMatchObject({ correct: false, fraction: 0 });
  expect(res.body.steps['lab-1-01-s5'].correctAnswer).toBeDefined();
  expect(await db.query("SELECT 1 FROM attempts WHERE user_id = ? AND question_id = 'lab-1-01-s5'", [user.id])).toHaveLength(0);

  const before = await db.query('SELECT 1 FROM lab_results WHERE user_id = ?', [user.id]);
  const bad = await agent.post('/api/labs/lab-1-01/submit').send({ answers: { ...RIGHT, 'lab-1-01-zzz': RIGHT['lab-1-01-s1'] } });
  expect(bad.status).toBe(400);
  expect(await db.query('SELECT 1 FROM lab_results WHERE user_id = ?', [user.id])).toHaveLength(before.length);
});

test('a wrong-shaped step answer is 400 and nothing is recorded', async () => {
  const { agent, db, user } = await setup();
  const res = await agent
    .post('/api/labs/lab-1-01/submit')
    .send({ answers: { ...RIGHT, 'lab-1-01-s4': { type: 'single', choice: 'b' } } });
  expect(res.status).toBe(400);
  expect(await db.query('SELECT 1 FROM attempts WHERE user_id = ?', [user.id])).toHaveLength(0);
  expect(await db.query('SELECT 1 FROM xp_events WHERE user_id = ?', [user.id])).toHaveLength(0);
  expect(await db.query('SELECT 1 FROM lab_results WHERE user_id = ?', [user.id])).toHaveLength(0);
});

test('third distinct passed lab returns lab-rat in newBadges', async () => {
  const { agent, db, user } = await setup();
  for (const id of ['lab-old-1', 'lab-old-2']) {
    await db.exec('INSERT INTO lab_results (user_id, lab_id, score_pct, passed, created_at) VALUES (?, ?, 100, 1, ?)', [user.id, id, now]);
  }
  const res = await agent.post('/api/labs/lab-1-01/submit').send({ answers: RIGHT });
  expect(res.body.newBadges).toContain('lab-rat');
  const again = await agent.post('/api/labs/lab-1-01/submit').send({ answers: RIGHT });
  expect(again.body.newBadges).not.toContain('lab-rat');
});
