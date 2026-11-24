import { expect, test, vi } from 'vitest';
import type { Db } from '../../db/db.js';
import { createUser, loginAs, testApp } from '../../test/helpers.js';
import { addFlashcards, dueCount, scheduleMiss } from './repo.js';

const now = new Date('2026-11-10T12:00:00Z');
const TODAY = '2026-11-10';
const enc = encodeURIComponent;

async function setup(timeZone = 'UTC') {
  const t = await testApp({ now: () => now });
  const user = await createUser(t.db, { timeZone });
  const agent = await loginAs(t.app, user);
  return { ...t, user, agent };
}

async function card(db: Db, userId: number, cardId: string, box: number, dueOn: string) {
  await db.exec('INSERT INTO review_cards (user_id, card_id, box, due_on) VALUES (?, ?, ?, ?)', [userId, cardId, box, dueOn]);
}

async function row(db: Db, userId: number, cardId: string) {
  const rows = await db.query<{ box: number; due_on: string }>(
    'SELECT box, due_on FROM review_cards WHERE user_id = ? AND card_id = ?',
    [userId, cardId],
  );
  return rows[0];
}

const RIGHT = { answer: { type: 'single', choice: 'b' } }; // q-1.1-001 is answered by "b"
const WRONG = { answer: { type: 'single', choice: 'a' } };

test('due lists only cards with due_on <= today in the learner time zone, and no answers or definitions', async () => {
  // 12:00 UTC on 11-10 is already 11-11 in Auckland.
  const utc = await setup('UTC');
  await card(utc.db, utc.user.id, 'q:q-1.1-001', 1, TODAY);
  await card(utc.db, utc.user.id, 'q:q-1.1-002', 1, '2026-11-11');
  await card(utc.db, utc.user.id, 'f:f-1.1-001', 1, '2026-11-01');
  const res = await utc.agent.get('/api/review/due');
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(2);
  expect(res.body.cards.map((c: any) => c.cardId)).toEqual(['f:f-1.1-001', 'q:q-1.1-001']); // oldest due first
  const text = JSON.stringify(res.body);
  expect(text).not.toContain('Definition 1.1');
  expect(text).not.toMatch(/"(correct|explanation|why|definition)"/);
  expect(res.body.cards[0]).toEqual({ cardId: 'f:f-1.1-001', kind: 'flashcard', term: 'Term 1.1' });
  expect(res.body.cards[1].kind).toBe('question');
  expect(res.body.cards[1].question.id).toBe('q-1.1-001');

  const nz = await setup('Pacific/Auckland');
  await card(nz.db, nz.user.id, 'q:q-1.1-002', 1, '2026-11-11');
  const nzRes = await nz.agent.get('/api/review/due');
  expect(nzRes.body.total).toBe(1);
});

test('correct question review moves box 1 -> 2, due in 2 days, records an attempt with context review, awards repeatCorrect XP once per day', async () => {
  const { db, user, agent } = await setup();
  await card(db, user.id, 'q:q-1.1-001', 1, TODAY);
  const res = await agent.post(`/api/review/${enc('q:q-1.1-001')}`).send(RIGHT);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ box: 2, dueOn: '2026-11-12', xp: 2 });
  expect(res.body.feedback.correct).toBe(true);
  expect(await row(db, user.id, 'q:q-1.1-001')).toEqual({ box: 2, due_on: '2026-11-12' });
  const attempts = await db.query('SELECT question_id, correct, context FROM attempts WHERE user_id = ?', [user.id]);
  expect(attempts).toEqual([{ question_id: 'q-1.1-001', correct: 1, context: 'review' }]);

  // Same card becomes due again the same day (e.g. after a miss elsewhere): XP is not awarded twice.
  await db.exec("UPDATE review_cards SET due_on = ? WHERE user_id = ?", [TODAY, user.id]);
  const again = await agent.post(`/api/review/${enc('q:q-1.1-001')}`).send(RIGHT);
  expect(again.status).toBe(200);
  expect(again.body).toMatchObject({ box: 3, xp: 0 });
  const [{ n }] = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM xp_events WHERE user_id = ? AND reason = 'repeat-correct'", [user.id]);
  expect(Number(n)).toBe(1);
});

test('a question answered correctly again in practice and in review on the same local day earns the repeat XP once', async () => {
  const repeats = (db: Db, userId: number) =>
    db.query<{ ref: string }>("SELECT ref FROM xp_events WHERE user_id = ? AND reason = 'repeat-correct'", [userId]);
  const practice = (agent: Awaited<ReturnType<typeof setup>>['agent']) =>
    agent.post('/api/answers').send({ questionId: 'q-1.1-001', ...RIGHT });

  // Practice, practice again (the day's repeat XP), then the review of the same question: nothing more.
  const a = await setup();
  expect((await practice(a.agent)).body.xp).toBe(10); // first time correct
  expect((await practice(a.agent)).body.xp).toBe(2);
  await card(a.db, a.user.id, 'q:q-1.1-001', 1, TODAY);
  const review = await a.agent.post(`/api/review/${enc('q:q-1.1-001')}`).send(RIGHT);
  expect(review.body).toMatchObject({ box: 2, xp: 0 });
  expect(await repeats(a.db, a.user.id)).toEqual([{ ref: 'q-1.1-001@2026-11-10' }]);

  // The other way round: the review pays the day's repeat XP, and practising afterwards pays nothing more.
  const b = await setup();
  await b.db.exec("INSERT INTO xp_events (user_id, amount, reason, ref, created_at) VALUES (?, 10, 'first-correct', 'q-1.1-001', ?)", [b.user.id, now]);
  await card(b.db, b.user.id, 'q:q-1.1-001', 1, TODAY);
  expect((await b.agent.post(`/api/review/${enc('q:q-1.1-001')}`).send(RIGHT)).body.xp).toBe(2);
  expect((await practice(b.agent)).body.xp).toBe(0);
  expect(await repeats(b.db, b.user.id)).toEqual([{ ref: 'q-1.1-001@2026-11-10' }]);
});

test('wrong review resets a box-4 card to box 1 due tomorrow and returns feedback', async () => {
  const { db, user, agent } = await setup();
  await card(db, user.id, 'q:q-1.1-001', 4, TODAY);
  const res = await agent.post(`/api/review/${enc('q:q-1.1-001')}`).send(WRONG);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ box: 1, dueOn: '2026-11-11', xp: 0 });
  expect(res.body.feedback).toMatchObject({ correct: false, correctAnswer: { type: 'single', choice: 'b' } });
  expect(typeof res.body.feedback.explanation).toBe('string');
  expect(await row(db, user.id, 'q:q-1.1-001')).toEqual({ box: 1, due_on: '2026-11-11' });
  const attempts = await db.query('SELECT correct, context FROM attempts WHERE user_id = ?', [user.id]);
  expect(attempts).toEqual([{ correct: 0, context: 'review' }]);
});

test('flashcard knewIt=true promotes and awards flashcardKnown XP; knewIt=false resets', async () => {
  const { db, user, agent } = await setup();
  await card(db, user.id, 'f:f-1.1-001', 2, TODAY);
  await card(db, user.id, 'f:f-1.1-002', 3, TODAY);

  const known = await agent.post(`/api/review/${enc('f:f-1.1-001')}`).send({ knewIt: true });
  expect(known.status).toBe(200);
  expect(known.body).toEqual({ box: 3, previousBox: 2, dueOn: '2026-11-14', definition: 'Definition 1.1', xp: 2, newBadges: [] });

  const missed = await agent.post(`/api/review/${enc('f:f-1.1-002')}`).send({ knewIt: false });
  expect(missed.body).toEqual({ box: 1, previousBox: 3, dueOn: '2026-11-11', definition: 'Definition 1.2', xp: 0, newBadges: [] });
  const [{ n }] = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM attempts WHERE user_id = ?', [user.id]);
  expect(Number(n)).toBe(0);
});

test('flashcard reveal returns only the definition, for an owned card', async () => {
  const { db, user, agent } = await setup();
  await card(db, user.id, 'f:f-1.1-001', 1, '2026-12-01'); // not due: still revealable
  const res = await agent.get(`/api/review/flashcard/${enc('f:f-1.1-001')}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ definition: 'Definition 1.1' });
  expect(await row(db, user.id, 'f:f-1.1-001')).toEqual({ box: 1, due_on: '2026-12-01' });
  expect((await agent.get(`/api/review/flashcard/${enc('f:f-1.1-002')}`)).status).toBe(404);
  expect((await agent.get(`/api/review/flashcard/${enc('q:q-1.1-001')}`)).status).toBe(404);
});

test('reviewing a card that is not due returns 409', async () => {
  const { db, user, agent } = await setup();
  await card(db, user.id, 'q:q-1.1-001', 2, '2026-11-11');
  const res = await agent.post(`/api/review/${enc('q:q-1.1-001')}`).send(RIGHT);
  expect(res.status).toBe(409);
  expect(await row(db, user.id, 'q:q-1.1-001')).toEqual({ box: 2, due_on: '2026-11-11' });
});

test("reviewing another learner's card returns 404", async () => {
  const { db, agent } = await setup();
  const other = await createUser(db);
  await card(db, other.id, 'q:q-1.1-001', 1, TODAY);
  expect((await agent.post(`/api/review/${enc('q:q-1.1-001')}`).send(RIGHT)).status).toBe(404);
  expect((await agent.post(`/api/review/${enc('q:q-1.1-002')}`).send(RIGHT)).status).toBe(404);
  expect(await row(db, other.id, 'q:q-1.1-001')).toEqual({ box: 1, due_on: TODAY });
});

test('a card whose question or flashcard id no longer exists in content is omitted from due, excluded from dueCount, and POST to it returns 404 (not 500)', async () => {
  const { db, content, user, agent } = await setup();
  await card(db, user.id, 'q:q-gone-999', 1, TODAY);
  await card(db, user.id, 'f:f-gone-999', 1, TODAY);
  await card(db, user.id, 'q:q-1.1-001', 1, TODAY);
  const res = await agent.get('/api/review/due');
  expect(res.body.total).toBe(1);
  expect(res.body.cards.map((c: any) => c.cardId)).toEqual(['q:q-1.1-001']);
  expect(await dueCount(db, content, user.id, TODAY)).toBe(1);
  expect((await agent.post(`/api/review/${enc('q:q-gone-999')}`).send(RIGHT)).status).toBe(404);
  expect((await agent.post(`/api/review/${enc('f:f-gone-999')}`).send({ knewIt: true })).status).toBe(404);
  expect((await agent.get(`/api/review/flashcard/${enc('f:f-gone-999')}`)).status).toBe(404);
});

test('a body that does not match the card kind, or a wrong-shaped answer, is a 400', async () => {
  const { db, user, agent } = await setup();
  await card(db, user.id, 'q:q-1.1-001', 1, TODAY);
  await card(db, user.id, 'f:f-1.1-001', 1, TODAY);
  const q = `/api/review/${enc('q:q-1.1-001')}`;
  const f = `/api/review/${enc('f:f-1.1-001')}`;
  expect((await agent.post(q).send({ knewIt: true })).status).toBe(400);
  expect((await agent.post(q).send({ answer: { type: 'multi', choices: ['a'] } })).status).toBe(400);
  expect((await agent.post(q).send({ answer: { type: 'single', choice: 'nope' } })).status).toBe(400);
  expect((await agent.post(f).send(RIGHT)).status).toBe(400);
  expect((await agent.post(f).send({ knewIt: 'yes' })).status).toBe(400);
  expect(await row(db, user.id, 'q:q-1.1-001')).toEqual({ box: 1, due_on: TODAY });
});

test('review routes require sign-in', async () => {
  const { app } = await setup();
  const request = (await import('supertest')).default;
  expect((await request(app).get('/api/review/due')).status).toBe(401);
});

test('scheduleMiss on an existing box-3 card resets it to box 1', async () => {
  const { db, user } = await setup();
  await card(db, user.id, 'q:q-1.1-001', 3, '2026-11-20');
  await scheduleMiss(db, user.id, 'q:q-1.1-001', TODAY);
  expect(await row(db, user.id, 'q:q-1.1-001')).toEqual({ box: 1, due_on: '2026-11-11' });
  await scheduleMiss(db, user.id, 'q:q-1.1-002', TODAY); // new card
  expect(await row(db, user.id, 'q:q-1.1-002')).toEqual({ box: 1, due_on: '2026-11-11' });
});

test('addFlashcards does not reset cards the learner already has', async () => {
  const { db, user } = await setup();
  await card(db, user.id, 'f:f-1.1-001', 4, '2026-11-18');
  await addFlashcards(db, user.id, ['f-1.1-001', 'f-1.1-002'], TODAY);
  expect(await row(db, user.id, 'f:f-1.1-001')).toEqual({ box: 4, due_on: '2026-11-18' });
  expect(await row(db, user.id, 'f:f-1.1-002')).toEqual({ box: 1, due_on: TODAY });
});

test('due reports nextDueOn: the earliest date after today among this learner\'s cards that still exist, or null', async () => {
  const { db, user, agent } = await setup();
  // No cards at all.
  expect((await agent.get('/api/review/due')).body).toEqual({ total: 0, cards: [], nextDueOn: null });

  // Only future cards: nothing is due, and the earliest of them is the next review.
  await card(db, user.id, 'q:q-1.1-001', 2, '2026-11-14');
  await card(db, user.id, 'f:f-1.1-001', 1, '2026-11-12');
  expect((await agent.get('/api/review/due')).body).toEqual({ total: 0, cards: [], nextDueOn: '2026-11-12' });

  // A card whose content is gone does not count, nor does another learner's card.
  await card(db, user.id, 'f:f-gone-999', 1, '2026-11-11');
  await card(db, user.id, 'q:q-gone-999', 1, '2026-11-11');
  const other = await createUser(db);
  await card(db, other.id, 'f:f-1.1-002', 1, '2026-11-11');
  expect((await agent.get('/api/review/due')).body.nextDueOn).toBe('2026-11-12');

  // A card that is due today is in the list; "next" stays the first date after today.
  await card(db, user.id, 'f:f-1.1-002', 1, TODAY);
  const res = await agent.get('/api/review/due');
  expect(res.body.total).toBe(1);
  expect(res.body.nextDueOn).toBe('2026-11-12');
});

test('nextDueOn follows the learner time zone', async () => {
  // 12:00 UTC on 11-10 is already 11-11 in Auckland: a card for 11-11 is due there, not "next".
  const nz = await setup('Pacific/Auckland');
  await card(nz.db, nz.user.id, 'f:f-1.1-001', 1, '2026-11-11');
  await card(nz.db, nz.user.id, 'f:f-1.1-002', 1, '2026-11-13');
  const res = await nz.agent.get('/api/review/due');
  expect(res.body.total).toBe(1);
  expect(res.body.nextDueOn).toBe('2026-11-13');
});

test('a review response carries previousBox: a right answer in box 5 stays there, a wrong one reports where it fell from', async () => {
  const { db, user, agent } = await setup();
  await card(db, user.id, 'q:q-1.1-001', 5, TODAY);
  await card(db, user.id, 'f:f-1.1-001', 5, TODAY);
  await card(db, user.id, 'f:f-1.1-002', 1, TODAY);
  await card(db, user.id, 'f:f-1.2-001', 4, TODAY);
  const top = await agent.post(`/api/review/${enc('q:q-1.1-001')}`).send(RIGHT);
  expect(top.body).toMatchObject({ box: 5, previousBox: 5, dueOn: '2026-11-26' });
  const topCard = await agent.post(`/api/review/${enc('f:f-1.1-001')}`).send({ knewIt: true });
  expect(topCard.body).toMatchObject({ box: 5, previousBox: 5 });
  const up = await agent.post(`/api/review/${enc('f:f-1.1-002')}`).send({ knewIt: true });
  expect(up.body).toMatchObject({ box: 2, previousBox: 1 });
  const down = await agent.post(`/api/review/${enc('f:f-1.2-001')}`).send({ knewIt: false });
  expect(down.body).toMatchObject({ box: 1, previousBox: 4 });
});

test('a review that completes a 3-day streak returns streak-3 once; a second review the same day returns no new badge', async () => {
  const { db, user, agent } = await setup();
  for (const daysAgo of [1, 2]) {
    await db.exec('INSERT INTO xp_events (user_id, amount, reason, ref, created_at) VALUES (?, 5, ?, ?, ?)', [
      user.id,
      'first-correct',
      `earlier-${daysAgo}`,
      new Date(now.getTime() - daysAgo * 86_400_000),
    ]);
  }
  await card(db, user.id, 'f:f-1.1-001', 1, TODAY);
  await card(db, user.id, 'f:f-1.1-002', 1, TODAY);
  await card(db, user.id, 'q:q-1.1-001', 1, TODAY);

  // Not known: no XP today, so the streak still ends yesterday at two days.
  const missed = await agent.post(`/api/review/${enc('f:f-1.1-001')}`).send({ knewIt: false });
  expect(missed.body).toMatchObject({ xp: 0, newBadges: [] });

  const first = await agent.post(`/api/review/${enc('f:f-1.1-002')}`).send({ knewIt: true });
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({ xp: 2, newBadges: ['streak-3'] });
  const held = await db.query<{ badge_id: string; earned_at: Date }>('SELECT badge_id, earned_at FROM badges WHERE user_id = ?', [user.id]);
  expect(held.map((b) => b.badge_id)).toEqual(['streak-3']);
  expect(new Date(held[0]!.earned_at).toISOString()).toBe(now.toISOString());

  const second = await agent.post(`/api/review/${enc('q:q-1.1-001')}`).send(RIGHT);
  expect(second.body).toMatchObject({ xp: 2, newBadges: [] });
  expect(await db.query('SELECT 1 FROM badges WHERE user_id = ?', [user.id])).toHaveLength(1);
});

test('a failure while evaluating badges does not report the recorded review as failed', async () => {
  const { db, user, agent } = await setup();
  await card(db, user.id, 'f:f-1.1-001', 1, TODAY);

  // Badge evaluation reads the badges table first; the card move and the XP award do not touch it.
  const query = db.query.bind(db);
  const failing = vi.spyOn(db, 'query').mockImplementation(((sql: string, params?: unknown[]) =>
    /\bbadges\b/.test(sql) ? Promise.reject(new Error('badges unavailable')) : query(sql, params)) as typeof db.query);
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const res = await agent.post(`/api/review/${enc('f:f-1.1-001')}`).send({ knewIt: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ box: 2, previousBox: 1, xp: 2, newBadges: [] });
    expect(logged).toHaveBeenCalledTimes(1);
  } finally {
    failing.mockRestore();
    logged.mockRestore();
  }
  const [moved] = await db.query<{ box: number }>('SELECT box FROM review_cards WHERE user_id = ? AND card_id = ?', [
    user.id,
    'f:f-1.1-001',
  ]);
  expect(moved!.box).toBe(2);
});

test('the hundredth correct attempt, made in a review, returns hundred-correct; a rejected review evaluates nothing', async () => {
  const { db, user, agent } = await setup();
  for (let i = 0; i < 99; i++) {
    await db.exec("INSERT INTO attempts (user_id, question_id, correct, context, created_at) VALUES (?, 'q-1.1-002', 1, 'quiz', ?)", [user.id, now]);
  }
  await card(db, user.id, 'q:q-1.1-001', 1, TODAY);
  await card(db, user.id, 'q:q-1.1-002', 1, '2026-11-11');
  // Not due: 409, and no badge is written on the way out.
  expect((await agent.post(`/api/review/${enc('q:q-1.1-002')}`).send(RIGHT)).status).toBe(409);
  expect(await db.query('SELECT 1 FROM badges WHERE user_id = ?', [user.id])).toHaveLength(0);
  const res = await agent.post(`/api/review/${enc('q:q-1.1-001')}`).send(RIGHT);
  expect(res.body.newBadges).toEqual(['hundred-correct']);
});
