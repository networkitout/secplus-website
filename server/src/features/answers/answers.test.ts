import { expect, test } from 'vitest';
import { createUser, loginAs, testApp } from '../../test/helpers.js';
import { DuplicateAttemptError, recordAnswer } from './repo.js';

const now = new Date('2026-11-10T12:00:00Z');
const RIGHT = { questionId: 'q-1.1-001', answer: { type: 'single', choice: 'b' } }; // difficulty 1
const WRONG = { questionId: 'q-1.1-001', answer: { type: 'single', choice: 'a' } };

async function setup() {
  const t = await testApp({ now: () => now });
  const user = await createUser(t.db);
  const agent = await loginAs(t.app, user);
  return { ...t, user, agent };
}

test('correct first answer: attempt row, XP 10 × difficulty, feedback.correct true', async () => {
  const { agent, db, user, content } = await setup();
  const q = content.questions.get('q-1.1-002')!; // difficulty 2
  const answer = { type: 'multi', choices: q.type === 'multi' ? q.correct : [] };
  const res = await agent.post('/api/answers').send({ questionId: q.id, answer });
  expect(res.status).toBe(200);
  expect(res.body.feedback.correct).toBe(true);
  expect(res.body.xp).toBe(10 * q.difficulty);
  const attempts = await db.query('SELECT question_id, correct, context FROM attempts WHERE user_id = ?', [user.id]);
  expect(attempts).toEqual([{ question_id: q.id, correct: 1, context: 'lesson' }]);
  const xp = await db.query('SELECT amount, reason, ref FROM xp_events WHERE user_id = ?', [user.id]);
  expect(xp).toEqual([{ amount: 20, reason: 'first-correct', ref: q.id }]);
});

test('second correct answer the same day awards 2 XP; a third the same day awards 0', async () => {
  const { agent } = await setup();
  const xps: number[] = [];
  for (let i = 0; i < 3; i++) xps.push((await agent.post('/api/answers').send(RIGHT)).body.xp);
  expect(xps).toEqual([10, 2, 0]);
});

test('wrong answer: no XP, creates review card q:<id> in box 1 due tomorrow, feedback has correctAnswer, explanation and why', async () => {
  const { agent, db, user } = await setup();
  const res = await agent.post('/api/answers').send(WRONG);
  expect(res.status).toBe(200);
  expect(res.body.xp).toBe(0);
  expect(res.body.feedback).toMatchObject({
    correct: false,
    correctAnswer: { type: 'single', choice: 'b' },
    explanation: 'Fixture explanation for q-1.1-001.',
  });
  expect(res.body.feedback.why).toBeTruthy();
  const cards = await db.query('SELECT card_id, box, due_on FROM review_cards WHERE user_id = ?', [user.id]);
  expect(cards).toEqual([{ card_id: 'q:q-1.1-001', box: 1, due_on: '2026-11-11' }]);
  expect(await db.query('SELECT 1 FROM xp_events WHERE user_id = ?', [user.id])).toHaveLength(0);
});

test('answer whose type does not match the question returns 400; unknown questionId returns 404', async () => {
  const { agent, db, user } = await setup();
  const bad = await agent.post('/api/answers').send({ questionId: 'q-1.1-001', answer: { type: 'multi', choices: ['a'] } });
  expect(bad.status).toBe(400);
  expect((await agent.post('/api/answers').send({ questionId: 'q-1.1-001', answer: { nonsense: true } })).status).toBe(400);
  expect((await agent.post('/api/answers').send({ questionId: 'nope', answer: RIGHT.answer })).status).toBe(404);
  expect((await agent.post('/api/answers').send({ questionId: 'lab-1-01-s1', answer: RIGHT.answer })).status).toBe(404);
  expect(await db.query('SELECT 1 FROM attempts WHERE user_id = ?', [user.id])).toHaveLength(0);
});

test('question in a locked domain returns 403', async () => {
  const { agent, content, db, user } = await setup();
  content.manifest.domains[1]!.objectives[0]!.published = true;
  content.questions.set('q-2.1-001', { ...content.questions.get('q-1.1-001')!, id: 'q-2.1-001', objective: '2.1' });
  const res = await agent.post('/api/answers').send({ questionId: 'q-2.1-001', answer: RIGHT.answer });
  expect(res.status).toBe(403);
  expect(await db.query('SELECT 1 FROM attempts WHERE user_id = ?', [user.id])).toHaveLength(0);
});

test('two identical POSTs in parallel (Promise.all) leave first-correct XP awarded exactly once', async () => {
  const { agent, db, user } = await setup();
  const rs = await Promise.all([agent.post('/api/answers').send(RIGHT), agent.post('/api/answers').send(RIGHT)]);
  expect(rs.map((r) => r.status)).toEqual([200, 200]);
  expect(rs.map((r) => r.body.xp).sort((a, b) => a - b)).toEqual([2, 10]);
  const first = await db.query("SELECT 1 FROM xp_events WHERE user_id = ? AND reason = 'first-correct'", [user.id]);
  expect(first).toHaveLength(1);
});

test('recordAnswer: duplicate (assessment, question) throws and awards/schedules nothing more; review and lab misses are not scheduled', async () => {
  const { db, user, content } = await setup();
  const q = content.questions.get('q-1.1-001')!;
  const u = { id: user.id, timeZone: 'UTC' };
  const asm = await db.exec(
    "INSERT INTO assessments (user_id, kind, scope, question_ids, answers, flags, started_at) VALUES (?, 'objective', '1.1', '[]', '{}', '[]', ?)",
    [user.id, now],
  );
  const right = { type: 'single', choice: 'b' } as const;
  const wrong = { type: 'single', choice: 'a' } as const;
  const first = await recordAnswer(db, content, { user: u, question: q, answer: right, context: 'quiz', assessmentId: asm.insertId, now });
  expect(first.xp).toBe(10);
  await expect(
    recordAnswer(db, content, { user: u, question: q, answer: wrong, context: 'quiz', assessmentId: asm.insertId, now }),
  ).rejects.toBeInstanceOf(DuplicateAttemptError);
  expect(await db.query('SELECT 1 FROM attempts WHERE user_id = ?', [user.id])).toHaveLength(1);
  expect(await db.query('SELECT 1 FROM review_cards WHERE user_id = ?', [user.id])).toHaveLength(0);

  await recordAnswer(db, content, { user: u, question: q, answer: wrong, context: 'lab', now });
  await recordAnswer(db, content, { user: u, question: q, answer: wrong, context: 'review', now });
  expect(await db.query('SELECT 1 FROM review_cards WHERE user_id = ?', [user.id])).toHaveLength(0);
});
