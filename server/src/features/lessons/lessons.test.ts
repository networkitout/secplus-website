import { expect, test, vi } from 'vitest';
import { createUser, loginAs, testApp } from '../../test/helpers.js';

const now = new Date('2026-11-10T12:00:00Z');

async function setup() {
  const t = await testApp({ now: () => now });
  const user = await createUser(t.db);
  const agent = await loginAs(t.app, user);
  return { ...t, user, agent };
}

test('GET returns sections; check blocks contain a PublicQuestion with no correct/explanation/why anywhere in the JSON', async () => {
  const { agent } = await setup();
  const res = await agent.get('/api/lessons/1.1');
  expect(res.status).toBe(200);
  expect(res.body.lesson.sections.map((s: any) => s.id)).toEqual(['s1', 's2']);
  expect(res.body.progress).toEqual({ sectionsDone: [], completedAt: null });
  const check = res.body.lesson.sections[1].blocks.find((b: any) => b.kind === 'check');
  expect(check.question.id).toBe('q-1.1-001');
  expect(check.question.options).toHaveLength(4);
  expect(check.questionId).toBeUndefined();
  expect(JSON.stringify(res.body)).not.toMatch(/"(correct|explanation|why)"/);
});

test('unknown objective 404; unpublished objective 404; objective in a locked domain 403', async () => {
  const { agent, content } = await setup();
  expect((await agent.get('/api/lessons/9.9')).status).toBe(404);
  expect((await agent.get('/api/lessons/2.1')).status).toBe(404); // unpublished in the fixture
  content.manifest.domains[1]!.objectives[0]!.published = true;
  content.lessons.set('2.1', { ...content.lessons.get('1.1')!, objective: '2.1' });
  expect((await agent.get('/api/lessons/2.1')).status).toBe(403);
  expect((await agent.post('/api/lessons/2.1/progress').send({ sectionId: 's1' })).status).toBe(403);
});

test('a passed domain 1 exam unlocks domain 2', async () => {
  const { agent, content, db, user } = await setup();
  content.manifest.domains[1]!.objectives[0]!.published = true;
  content.lessons.set('2.1', { ...content.lessons.get('1.1')!, objective: '2.1' });
  await db.exec(
    "INSERT INTO assessments (user_id, kind, scope, question_ids, answers, flags, started_at, submitted_at, passed) VALUES (?, 'domain', '1', '[]', '{}', '[]', ?, ?, 1)",
    [user.id, now, now],
  );
  expect((await agent.get('/api/lessons/2.1')).status).toBe(200);
});

test("marking the last section sets completedAt, awards 50 XP once, adds the objective's flashcards as review cards, returns first-lesson badge", async () => {
  const { agent, db, user } = await setup();
  const first = await agent.post('/api/lessons/1.1/progress').send({ sectionId: 's1' });
  expect(first.status).toBe(200);
  expect(first.body).toEqual({ sectionsDone: ['s1'], completedAt: null, xp: 0, newBadges: [] });

  const last = await agent.post('/api/lessons/1.1/progress').send({ sectionId: 's2' });
  expect(last.status).toBe(200);
  expect(last.body.sectionsDone).toEqual(['s1', 's2']);
  expect(last.body.completedAt).toBe(now.toISOString());
  expect(last.body.xp).toBe(50);
  expect(last.body.newBadges).toContain('first-lesson');

  const xp = await db.query('SELECT amount, reason, ref FROM xp_events WHERE user_id = ?', [user.id]);
  expect(xp).toEqual([{ amount: 50, reason: 'lesson', ref: '1.1' }]);
  const cards = await db.query('SELECT card_id, box, due_on FROM review_cards WHERE user_id = ? ORDER BY card_id', [user.id]);
  expect(cards).toEqual([
    { card_id: 'f:f-1.1-001', box: 1, due_on: '2026-11-10' },
    { card_id: 'f:f-1.1-002', box: 1, due_on: '2026-11-10' },
  ]);

  const again = await agent.post('/api/lessons/1.1/progress').send({ sectionId: 's2' });
  expect(again.body).toMatchObject({ xp: 0, newBadges: [], completedAt: now.toISOString() });
  const get = await agent.get('/api/lessons/1.1');
  expect(get.body.progress).toEqual({ sectionsDone: ['s1', 's2'], completedAt: now.toISOString() });
});

test('marking the same section twice is a no-op; unknown sectionId is 400', async () => {
  const { agent, db, user } = await setup();
  await agent.post('/api/lessons/1.1/progress').send({ sectionId: 's1' });
  const again = await agent.post('/api/lessons/1.1/progress').send({ sectionId: 's1' });
  expect(again.body.sectionsDone).toEqual(['s1']);
  expect((await agent.post('/api/lessons/1.1/progress').send({ sectionId: 'nope' })).status).toBe(400);
  expect((await agent.post('/api/lessons/1.1/progress').send({})).status).toBe(400);
  const rows = await db.query('SELECT sections_done FROM lesson_progress WHERE user_id = ?', [user.id]);
  expect(rows).toHaveLength(1);
});

test('parallel progress posts never fail and award the lesson XP exactly once', async () => {
  const { agent, db, user } = await setup();
  for (let round = 0; round < 30; round++) {
    await db.exec('DELETE FROM lesson_progress WHERE user_id = ?', [user.id]);
    await db.exec('DELETE FROM xp_events WHERE user_id = ?', [user.id]);
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => agent.post('/api/lessons/1.1/progress').send({ sectionId: i % 2 ? 's1' : 's2' })),
    );
    expect(rs.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(rs.reduce((n, r) => n + r.body.xp, 0)).toBe(50);
    const [{ n }] = await db.query("SELECT COUNT(*) AS n FROM xp_events WHERE user_id = ? AND reason = 'lesson'", [user.id]);
    expect(Number(n)).toBe(1);
  }
}, 60_000);

test('lessons require sign-in', async () => {
  const { app } = await setup();
  const request = (await import('supertest')).default;
  expect((await request(app).get('/api/lessons/1.1')).status).toBe(401);
});

test('a failure while evaluating badges does not fail saved progress: it is logged and reports no new badges', async () => {
  const { agent, db, user } = await setup();
  await agent.post('/api/lessons/1.1/progress').send({ sectionId: 's1' });
  const query = db.query.bind(db);
  const failing = vi.spyOn(db, 'query').mockImplementation(((sql: string, params?: unknown[]) =>
    /\bbadges\b/.test(sql) ? Promise.reject(new Error('badges unavailable')) : query(sql, params)) as typeof db.query);
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const last = await agent.post('/api/lessons/1.1/progress').send({ sectionId: 's2' });
    expect(last.status).toBe(200);
    expect(last.body).toEqual({ sectionsDone: ['s1', 's2'], completedAt: now.toISOString(), xp: 50, newBadges: [] });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]![0])).toContain(`Badge evaluation failed for user ${user.id}`);
  } finally {
    failing.mockRestore();
    logged.mockRestore();
  }
  // The lesson is complete, and the next evaluation awards the badge this one missed.
  const again = await agent.post('/api/lessons/1.1/progress').send({ sectionId: 's2' });
  expect(again.body).toMatchObject({ xp: 0, newBadges: ['first-lesson'] });
});
