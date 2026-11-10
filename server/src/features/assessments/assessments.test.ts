import { expect, test, vi } from 'vitest';
import type { Answer, Question } from '../../../../shared/types.js';
import type { Content } from '../../content/loader.js';
import { createUser, loginAs, testApp } from '../../test/helpers.js';
import { unlockedDomains } from '../access.js';

const t0 = new Date('2026-11-10T12:00:00Z');
const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);

async function setup() {
  const t = await testApp({ now: () => t0 });
  const user = await createUser(t.db);
  const agent = await loginAs(t.app, user);
  return { ...t, user, agent };
}
type Agent = Awaited<ReturnType<typeof setup>>['agent'];

/** A valid answer that is right (or valid-shaped but wrong). */
function answerFor(q: Question, right: boolean): Answer {
  switch (q.type) {
    case 'single':
      return { type: 'single', choice: right ? q.correct : q.options.find((o) => o.id !== q.correct)!.id };
    case 'multi':
      return { type: 'multi', choices: right ? [...q.correct] : [] };
    case 'order':
      return { type: 'order', order: right ? [...q.correct] : [...q.correct].reverse() };
    case 'match':
      return { type: 'match', pairs: right ? { ...q.correct } : {} };
    case 'categorize':
      return { type: 'categorize', placements: right ? { ...q.correct } : {} };
  }
}

async function start(agent: Agent, body: object) {
  return agent.post('/api/assessments').send(body);
}
async function put(agent: Agent, content: Content, id: number, qid: string, right: boolean) {
  return agent.put(`/api/assessments/${id}/answers`).send({ questionId: qid, answer: answerFor(content.questions.get(qid)!, right) });
}
/** Answers the first `right` questions correctly and the next `wrong` ones wrongly. */
async function answer(agent: Agent, content: Content, id: number, qids: string[], right: number, wrong = 0) {
  for (let i = 0; i < right + wrong; i++) {
    const res = await put(agent, content, id, qids[i]!, i < right);
    expect(res.status).toBe(200);
  }
}
const idsOf = (body: any): string[] => body.questions.map((q: any) => q.id);

function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysDeep(x, out);
    }
  return out;
}

// ---------------------------------------------------------------- objective quiz

test('start returns 201 with 10 PublicQuestions and no answer data in the JSON', async () => {
  const { agent } = await setup();
  const res = await start(agent, { kind: 'objective', scope: '1.1' });
  expect(res.status).toBe(201);
  const got = await agent.get(`/api/assessments/${res.body.id}`);
  expect(got.status).toBe(200);
  expect(got.body).toMatchObject({ id: res.body.id, kind: 'objective', scope: '1.1', partial: false, deadlineAt: null, submittedAt: null });
  expect(got.body.questions).toHaveLength(10);
  expect(new Set(idsOf(got.body)).size).toBe(10);
  expect(idsOf(got.body).every((id: string) => id.startsWith('q-1.1-'))).toBe(true);
  expect(got.body.answers).toEqual({});
  expect(got.body.feedback).toEqual({});
  expect(got.body.result).toBeUndefined();
  const keys = keysDeep(got.body);
  for (const k of ['correct', 'explanation', 'why', 'correctAnswer']) expect(keys.has(k)).toBe(false);
  const again = await agent.get(`/api/assessments/${res.body.id}`);
  expect(again.body.questions).toEqual(got.body.questions); // same option order on reload
});

test('GET carries serverNow from the injected clock, for an open and for a finalized assessment', async () => {
  const { agent, setNow } = await setup();
  const quiz = await start(agent, { kind: 'objective', scope: '1.1' });
  expect((await agent.get(`/api/assessments/${quiz.body.id}`)).body.serverNow).toBe(t0.toISOString());

  const exam = await start(agent, { kind: 'domain', scope: '1' });
  setNow(minutes(10));
  const open = await agent.get(`/api/assessments/${exam.body.id}`);
  expect(open.body).toMatchObject({ serverNow: minutes(10).toISOString(), deadlineAt: minutes(25).toISOString(), submittedAt: null });

  setNow(minutes(26));
  const closed = await agent.get(`/api/assessments/${exam.body.id}`);
  expect(closed.body).toMatchObject({ serverNow: minutes(26).toISOString(), submittedAt: minutes(26).toISOString() });
});

test('starting again while one is open returns the same id', async () => {
  const { agent } = await setup();
  const a = await start(agent, { kind: 'objective', scope: '1.1' });
  const b = await start(agent, { kind: 'objective', scope: '1.1' });
  expect(b.status).toBe(200);
  expect(b.body.id).toBe(a.body.id);
  const other = await start(agent, { kind: 'objective', scope: '1.2' });
  expect(other.status).toBe(201);
  expect(other.body.id).not.toBe(a.body.id);
});

test('PUT answer returns feedback; GET then includes that feedback; changing a final answer returns 409', async () => {
  const { agent, content } = await setup();
  const { body } = await start(agent, { kind: 'objective', scope: '1.1' });
  const qid = idsOf((await agent.get(`/api/assessments/${body.id}`)).body)[0]!;
  const res = await put(agent, content, body.id, qid, false);
  expect(res.status).toBe(200);
  expect(res.body.feedback).toMatchObject({ correct: false });
  expect(res.body.feedback.explanation).toBeTruthy();
  const got = await agent.get(`/api/assessments/${body.id}`);
  expect(got.body.feedback[qid]).toEqual(res.body.feedback);
  expect(Object.keys(got.body.feedback)).toEqual([qid]);
  expect(got.body.answers[qid]).toBeTruthy();
  expect((await put(agent, content, body.id, qid, true)).status).toBe(409);
  expect((await agent.get(`/api/assessments/${body.id}`)).body.feedback[qid].correct).toBe(false);
});

test('the same PUT sent twice in parallel creates one attempt row', async () => {
  const { agent, content, db, user } = await setup();
  const { body } = await start(agent, { kind: 'objective', scope: '1.1' });
  const qid = idsOf((await agent.get(`/api/assessments/${body.id}`)).body)[0]!;
  const results = await Promise.all([put(agent, content, body.id, qid, true), put(agent, content, body.id, qid, true)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const rows = await db.query('SELECT context FROM attempts WHERE user_id = ? AND assessment_id = ?', [user.id, body.id]);
  expect(rows).toEqual([{ context: 'quiz' }]);
});

test('flagged may be toggled on an answered question; a PUT needs an answer or flagged', async () => {
  const { agent, content } = await setup();
  const { body } = await start(agent, { kind: 'objective', scope: '1.1' });
  const qid = idsOf((await agent.get(`/api/assessments/${body.id}`)).body)[0]!;
  await put(agent, content, body.id, qid, true);
  const f = await agent.put(`/api/assessments/${body.id}/answers`).send({ questionId: qid, flagged: true });
  expect(f.status).toBe(200);
  expect((await agent.get(`/api/assessments/${body.id}`)).body.flags).toEqual([qid]);
  await agent.put(`/api/assessments/${body.id}/answers`).send({ questionId: qid, flagged: false });
  expect((await agent.get(`/api/assessments/${body.id}`)).body.flags).toEqual([]);
  expect((await agent.put(`/api/assessments/${body.id}/answers`).send({ questionId: qid })).status).toBe(400);
});

test('submit with 8/10 correct: scorePct 80, passed true, 100 XP bonus; 7/10: passed false, no bonus', async () => {
  const { agent, content, db, user } = await setup();
  const earned = async () => Number((await db.query('SELECT COALESCE(SUM(amount), 0) AS s FROM xp_events WHERE user_id = ?', [user.id]))[0].s);
  const a = await start(agent, { kind: 'objective', scope: '1.1' });
  const ids = idsOf((await agent.get(`/api/assessments/${a.body.id}`)).body);
  await answer(agent, content, a.body.id, ids, 8, 2);
  const answersXp = await earned();
  expect(answersXp).toBeGreaterThan(0);
  const res = await agent.post(`/api/assessments/${a.body.id}/submit`);
  expect(res.status).toBe(200);
  // The result's xp is everything this quiz earned: the XP of its answers plus the pass bonus.
  expect(res.body.result).toMatchObject({ scorePct: 80, passed: true, xp: answersXp + 100 });
  expect(await earned()).toBe(answersXp + 100);
  expect(res.body.result.scaledScore).toBeUndefined();
  expect(res.body.result.byObjective).toEqual({ '1.1': { correct: 8, total: 10 } });
  expect(res.body.result.byDomain).toEqual({ '1': { correct: 8, total: 10 } });
  expect(res.body.result.newBadges).toContain('first-quiz-pass');
  const [xp] = await db.query("SELECT amount, ref FROM xp_events WHERE user_id = ? AND reason = 'quiz-pass'", [user.id]);
  expect(xp).toEqual({ amount: 100, ref: '1.1' });

  const got = await agent.get(`/api/assessments/${a.body.id}`);
  expect(got.body.submittedAt).toBeTruthy();
  expect(got.body.result.scorePct).toBe(80);
  expect(Object.keys(got.body.feedback)).toHaveLength(10); // everything is revealed after submit

  const before = await earned();
  const b = await start(agent, { kind: 'objective', scope: '1.1' });
  expect(b.status).toBe(201);
  const ids2 = idsOf((await agent.get(`/api/assessments/${b.body.id}`)).body);
  await answer(agent, content, b.body.id, ids2, 7, 3);
  const res2 = await agent.post(`/api/assessments/${b.body.id}/submit`);
  // A failed quiz earns no bonus, but still reports the XP of its correct answers.
  const secondXp = (await earned()) - before;
  expect(secondXp).toBeGreaterThan(0);
  expect(res2.body.result).toMatchObject({ scorePct: 70, passed: false, xp: secondXp, newBadges: [] });
  expect((await agent.get(`/api/assessments/${b.body.id}`)).body.result.xp).toBe(secondXp);
  expect(await db.query("SELECT 1 FROM xp_events WHERE user_id = ? AND reason = 'quiz-pass'", [user.id])).toHaveLength(1);
});

test('badges earned by an answer during a quiz are reported in its result, once', async () => {
  const { agent, content, db, user } = await setup();
  // 99 correct answers already: the first correct answer of the quiz earns "hundred-correct".
  for (let i = 0; i < 99; i++) {
    await db.exec("INSERT INTO attempts (user_id, question_id, correct, context, created_at) VALUES (?, 'q-1.2-001', 1, 'lesson', ?)", [user.id, t0]);
  }
  const a = await start(agent, { kind: 'objective', scope: '1.1' });
  const ids = idsOf((await agent.get(`/api/assessments/${a.body.id}`)).body);
  await answer(agent, content, a.body.id, ids, 1);
  expect(await db.query("SELECT 1 FROM badges WHERE user_id = ? AND badge_id = 'hundred-correct'", [user.id])).toHaveLength(1);
  const res = await agent.post(`/api/assessments/${a.body.id}/submit`);
  expect(res.body.result.passed).toBe(false);
  expect(res.body.result.newBadges).toEqual(['hundred-correct']);
  expect((await agent.post(`/api/assessments/${a.body.id}/submit`)).body).toEqual(res.body);
});

test('a failure while evaluating badges inside a quiz answer rolls the answer back: nothing is half-recorded', async () => {
  const { agent, content, db, user } = await setup();
  const a = await start(agent, { kind: 'objective', scope: '1.1' });
  const qid = idsOf((await agent.get(`/api/assessments/${a.body.id}`)).body)[0]!;
  // A quiz answer is marked inside one transaction, badges included: fail the badge read on its handle.
  const tx = db.tx;
  db.tx = (fn) =>
    tx((handle) => {
      const query = handle.query;
      handle.query = (sql, params) => (/FROM badges/.test(sql) ? Promise.reject(new Error('badges unavailable')) : query(sql, params));
      return fn(handle);
    });
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const res = await put(agent, content, a.body.id, qid, true);
    expect(res.status).toBe(500);
    expect(logged).toHaveBeenCalledTimes(1);
  } finally {
    db.tx = tx;
    logged.mockRestore();
  }
  expect(await db.query('SELECT 1 FROM attempts WHERE user_id = ?', [user.id])).toHaveLength(0);
  expect(await db.query('SELECT 1 FROM xp_events WHERE user_id = ?', [user.id])).toHaveLength(0);
  // Nothing was stored, so the same answer can be sent again.
  const retry = await put(agent, content, a.body.id, qid, true);
  expect(retry.status).toBe(200);
  expect(retry.body.feedback.correct).toBe(true);
});

test('unanswered questions count as wrong', async () => {
  const { agent, content } = await setup();
  const a = await start(agent, { kind: 'objective', scope: '1.2' });
  const ids = idsOf((await agent.get(`/api/assessments/${a.body.id}`)).body);
  await answer(agent, content, a.body.id, ids, 7);
  const res = await agent.post(`/api/assessments/${a.body.id}/submit`);
  // No pass bonus; what the seven correct answers earned (10 XP times the difficulty, first time correct) is reported.
  const answersXp = ids.slice(0, 7).reduce((sum, id) => sum + 10 * content.questions.get(id)!.difficulty, 0);
  expect(res.body.result).toMatchObject({ scorePct: 70, passed: false, xp: answersXp, newBadges: [] });
  const full = await agent.get(`/api/assessments/${a.body.id}`);
  const missed = ids[9]!;
  expect(full.body.feedback[missed]).toMatchObject({ correct: false, fraction: 0 });
  expect(full.body.feedback[missed].correctAnswer).toBeTruthy();
});

// ---------------------------------------------------------------- domain exam and mock

test('PUT returns {saved:true} with no feedback; GET before submit has feedback {} and no answer data', async () => {
  const { agent, content } = await setup();
  const a = await start(agent, { kind: 'domain', scope: '1' });
  expect(a.status).toBe(201);
  const got = await agent.get(`/api/assessments/${a.body.id}`);
  expect(got.body.questions).toHaveLength(24); // the fixture has 24 published questions (< 25)
  expect(got.body.deadlineAt).toBe(minutes(25).toISOString());
  const qid = idsOf(got.body)[0]!;
  const res = await put(agent, content, a.body.id, qid, true);
  expect(res.body).toEqual({ saved: true });
  const after = await agent.get(`/api/assessments/${a.body.id}`);
  expect(after.body.feedback).toEqual({});
  const keys = keysDeep(after.body);
  for (const k of ['correct', 'explanation', 'why', 'correctAnswer']) expect(keys.has(k)).toBe(false);
});

test('domain exam spreads questions evenly across the domain objectives', async () => {
  const { agent } = await setup();
  const a = await start(agent, { kind: 'domain', scope: '1' });
  const ids = idsOf((await agent.get(`/api/assessments/${a.body.id}`)).body);
  expect(ids.filter((i) => i.startsWith('q-1.1-'))).toHaveLength(12);
  expect(ids.filter((i) => i.startsWith('q-1.2-'))).toHaveLength(12);
});

test('answers can be changed before submit; flags round-trip', async () => {
  const { agent, content } = await setup();
  const a = await start(agent, { kind: 'domain', scope: '1' });
  const qid = idsOf((await agent.get(`/api/assessments/${a.body.id}`)).body)[0]!;
  await put(agent, content, a.body.id, qid, false);
  const first = (await agent.get(`/api/assessments/${a.body.id}`)).body.answers[qid];
  await put(agent, content, a.body.id, qid, true);
  const second = (await agent.get(`/api/assessments/${a.body.id}`)).body.answers[qid];
  expect(second).toEqual(answerFor(content.questions.get(qid)!, true));
  expect(second).not.toEqual(first);
  expect((await agent.put(`/api/assessments/${a.body.id}/answers`).send({ questionId: qid, flagged: true })).body).toEqual({ saved: true });
  // flagging does not drop the saved answer
  const got = await agent.get(`/api/assessments/${a.body.id}`);
  expect(got.body.flags).toEqual([qid]);
  expect(got.body.answers[qid]).toEqual(second);
  await agent.put(`/api/assessments/${a.body.id}/answers`).send({ questionId: qid, flagged: false });
  expect((await agent.get(`/api/assessments/${a.body.id}`)).body.flags).toEqual([]);
  // an answer of the wrong type is rejected
  const bad = await agent.put(`/api/assessments/${a.body.id}/answers`).send({ questionId: qid, answer: { type: 'order', order: ['x'] } });
  expect(bad.status).toBe(400);
});

test('submit writes one attempt per answered question with context exam and schedules misses for review', async () => {
  const { agent, content, db, user } = await setup();
  const a = await start(agent, { kind: 'domain', scope: '1' });
  const ids = idsOf((await agent.get(`/api/assessments/${a.body.id}`)).body);
  await answer(agent, content, a.body.id, ids, 5, 2); // 17 left unanswered
  expect(await db.query('SELECT 1 FROM attempts WHERE user_id = ?', [user.id])).toHaveLength(0); // nothing until submit
  const res = await agent.post(`/api/assessments/${a.body.id}/submit`);
  expect(res.status).toBe(200);
  expect(res.body.result.passed).toBe(false);
  const rows = await db.query<{ context: string; assessment_id: number }>('SELECT context, assessment_id FROM attempts WHERE user_id = ?', [user.id]);
  expect(rows).toHaveLength(7);
  expect(rows.every((r) => r.context === 'exam' && r.assessment_id === a.body.id)).toBe(true);
  const cards = await db.query('SELECT card_id FROM review_cards WHERE user_id = ?', [user.id]);
  expect(cards.map((c: any) => c.card_id).sort()).toEqual(ids.slice(5, 7).map((i) => `q:${i}`).sort());
  expect(res.body.result.xp).toBeGreaterThan(0); // question XP is counted in the submit result
});

test('domain exam at 75% passes, unlocks the next domain in unlockedDomains, awards 300 XP once across two passing attempts', async () => {
  const { agent, content, db, user } = await setup();
  expect(await unlockedDomains(db, content, user.id)).toEqual([1]);
  const a = await start(agent, { kind: 'domain', scope: '1' });
  const ids = idsOf((await agent.get(`/api/assessments/${a.body.id}`)).body);
  await answer(agent, content, a.body.id, ids, 18, 6); // 18/24 = 75%
  const res = await agent.post(`/api/assessments/${a.body.id}/submit`);
  expect(res.body.result).toMatchObject({ scorePct: 75, passed: true });
  expect(res.body.result.scaledScore).toBeUndefined();
  expect(res.body.result.newBadges).toContain('domain-1-complete');
  expect(await unlockedDomains(db, content, user.id)).toEqual([1, 2]);
  const bonus = () => db.query("SELECT amount, ref FROM xp_events WHERE user_id = ? AND reason = 'domain-pass'", [user.id]);
  expect(await bonus()).toEqual([{ amount: 300, ref: '1' }]);

  const b = await start(agent, { kind: 'domain', scope: '1' });
  expect(b.status).toBe(201);
  expect(b.body.id).not.toBe(a.body.id);
  const ids2 = idsOf((await agent.get(`/api/assessments/${b.body.id}`)).body);
  await answer(agent, content, b.body.id, ids2, 20, 4);
  const res2 = await agent.post(`/api/assessments/${b.body.id}/submit`);
  expect(res2.body.result.passed).toBe(true);
  expect(await bonus()).toHaveLength(1);
});

test('submitting an exam evaluates badges once, after every answer is recorded, and reports each badge it earned once', async () => {
  const { agent, content, db, user } = await setup();
  // Two days of study before today, and 99 correct answers: the exam's first correct answer completes a
  // three-day streak and the hundredth correct answer; passing it completes the domain.
  for (const daysAgo of [1, 2]) {
    await db.exec("INSERT INTO xp_events (user_id, amount, reason, ref, created_at) VALUES (?, 5, 'test', ?, ?)", [
      user.id,
      `earlier-${daysAgo}`,
      new Date(t0.getTime() - daysAgo * 86_400_000),
    ]);
  }
  for (let i = 0; i < 99; i++) {
    await db.exec("INSERT INTO attempts (user_id, question_id, correct, context, created_at) VALUES (?, 'q-gone-001', 1, 'lesson', ?)", [user.id, t0]);
  }
  const a = await start(agent, { kind: 'domain', scope: '1' });
  const ids = idsOf((await agent.get(`/api/assessments/${a.body.id}`)).body);
  await answer(agent, content, a.body.id, ids, 20, 4);

  // Everything finalize does goes through its transaction handle: count what it reads from `badges`.
  const tx = db.tx;
  let badgeReads = 0;
  db.tx = (fn) =>
    tx((handle) => {
      const query = handle.query;
      handle.query = (sql, params) => {
        if (/FROM badges/.test(sql)) badgeReads++;
        return query(sql, params);
      };
      return fn(handle);
    });
  let res;
  try {
    res = await agent.post(`/api/assessments/${a.body.id}/submit`);
  } finally {
    db.tx = tx;
  }
  expect(res.status).toBe(200);
  expect(res.body.result.passed).toBe(true);
  expect(badgeReads).toBe(1);
  expect([...res.body.result.newBadges].sort()).toEqual(['domain-1-complete', 'hundred-correct', 'streak-3']);
  const held = await db.query<{ badge_id: string }>('SELECT badge_id FROM badges WHERE user_id = ? ORDER BY badge_id', [user.id]);
  expect(held.map((b) => b.badge_id)).toEqual(['domain-1-complete', 'hundred-correct', 'streak-3']);
  // The stored result is the same one.
  expect((await agent.get(`/api/assessments/${a.body.id}`)).body.result).toEqual(res.body.result);
});

test('mock result has scaledScore and byDomain; a passing partial mock awards no bonus XP', async () => {
  const { agent, content, db, user } = await setup();
  const a = await start(agent, { kind: 'mock' });
  expect(a.status).toBe(201);
  const got = await agent.get(`/api/assessments/${a.body.id}`);
  expect(got.body).toMatchObject({ kind: 'mock', scope: null, partial: true });
  expect(got.body.questions).toHaveLength(4);
  expect(got.body.deadlineAt).toBe(minutes(4).toISOString());
  const ids = idsOf(got.body);
  await answer(agent, content, a.body.id, ids, 3, 1); // 3/4 = 0.75 -> 700
  const fail = await agent.post(`/api/assessments/${a.body.id}/submit`);
  expect(fail.body.result).toMatchObject({ scorePct: 75, scaledScore: 700, passed: false });
  expect(fail.body.result.byDomain).toEqual({ '1': { correct: 3, total: 4 } });

  const b = await start(agent, { kind: 'mock' });
  const ids2 = idsOf((await agent.get(`/api/assessments/${b.body.id}`)).body);
  await answer(agent, content, b.body.id, ids2, 4);
  const pass = await agent.post(`/api/assessments/${b.body.id}/submit`);
  expect(pass.body.result).toMatchObject({ scorePct: 100, scaledScore: 900, passed: true });
  expect(pass.body.result.newBadges).toContain('first-mock-pass');
  expect(await db.query("SELECT amount, ref FROM xp_events WHERE user_id = ? AND reason = 'mock-pass'", [user.id])).toEqual([]);
  const stored = await agent.get(`/api/assessments/${b.body.id}`);
  expect(stored.body.partial).toBe(true); // still reported after finalize
  expect(stored.body.result.scaledScore).toBe(900);
});

test('a passing non-partial mock awards 500 XP once per learner-local day', async () => {
  const { agent, content, db, user, setNow } = await setup();
  content.manifest.domains.splice(1); // only domain 1 remains, so every domain has content: the mock is not partial
  const bonus = () => db.query("SELECT amount, ref FROM xp_events WHERE user_id = ? AND reason = 'mock-pass'", [user.id]);
  const passMock = async () => {
    const a = await start(agent, { kind: 'mock' });
    const got = await agent.get(`/api/assessments/${a.body.id}`);
    expect(got.body.partial).toBe(false);
    await answer(agent, content, a.body.id, idsOf(got.body), got.body.questions.length);
    const res = await agent.post(`/api/assessments/${a.body.id}/submit`);
    expect(res.body.result.passed).toBe(true);
    return res.body.result;
  };
  const first = await passMock();
  expect(await bonus()).toEqual([{ amount: 500, ref: '2026-11-10' }]);
  expect(first.xp).toBeGreaterThanOrEqual(500);
  setNow(minutes(30)); // same local day: no second bonus
  await passMock();
  expect(await bonus()).toHaveLength(1);
  setNow(new Date('2026-11-11T12:00:00Z'));
  await passMock();
  expect(await bonus()).toEqual([
    { amount: 500, ref: '2026-11-10' },
    { amount: 500, ref: '2026-11-11' },
  ]);
});

test('after deadline: PUT returns 409; GET returns the assessment already finalized with saved answers scored', async () => {
  const { agent, content, setNow, db, user } = await setup();
  const a = await start(agent, { kind: 'domain', scope: '1' });
  const ids = idsOf((await agent.get(`/api/assessments/${a.body.id}`)).body);
  await answer(agent, content, a.body.id, ids, 6);
  setNow(minutes(25)); // exactly at the deadline is still open
  expect((await put(agent, content, a.body.id, ids[6]!, true)).status).toBe(200);
  setNow(new Date(minutes(25).getTime() + 1));
  expect((await put(agent, content, a.body.id, ids[7]!, true)).status).toBe(409);
  const got = await agent.get(`/api/assessments/${a.body.id}`);
  expect(got.body.submittedAt).toBeTruthy();
  expect(got.body.result).toMatchObject({ scorePct: 29.17, passed: false }); // 7 of 24
  expect(Object.keys(got.body.feedback)).toHaveLength(24);
  expect(await db.query('SELECT 1 FROM attempts WHERE user_id = ?', [user.id])).toHaveLength(7);
});

test('after deadline: submit returns the result, and starting again creates a fresh assessment', async () => {
  const { agent, content, setNow } = await setup();
  const a = await start(agent, { kind: 'domain', scope: '1' });
  const ids = idsOf((await agent.get(`/api/assessments/${a.body.id}`)).body);
  await answer(agent, content, a.body.id, ids, 2);
  setNow(minutes(60));
  const res = await agent.post(`/api/assessments/${a.body.id}/submit`);
  expect(res.status).toBe(200);
  expect(res.body.result.scorePct).toBe(8.33);
  const b = await start(agent, { kind: 'domain', scope: '1' });
  expect(b.status).toBe(201);
  expect(b.body.id).not.toBe(a.body.id);
  setNow(minutes(200)); // an expired open assessment is finalized rather than returned
  const c = await start(agent, { kind: 'domain', scope: '1' });
  expect(c.status).toBe(201);
  expect(c.body.id).not.toBe(b.body.id);
});

test('submit twice returns the same result and awards XP once', async () => {
  const { agent, content, db, user } = await setup();
  const a = await start(agent, { kind: 'mock' });
  const ids = idsOf((await agent.get(`/api/assessments/${a.body.id}`)).body);
  await answer(agent, content, a.body.id, ids, 4);
  const first = await agent.post(`/api/assessments/${a.body.id}/submit`);
  const total = async () => Number((await db.query('SELECT SUM(amount) AS s FROM xp_events WHERE user_id = ?', [user.id]))[0].s);
  const before = await total();
  const second = await agent.post(`/api/assessments/${a.body.id}/submit`);
  expect(second.status).toBe(200);
  expect(second.body).toEqual(first.body);
  expect(await total()).toBe(before);
  expect(await db.query('SELECT 1 FROM attempts WHERE user_id = ?', [user.id])).toHaveLength(4);
  expect((await put(agent, content, a.body.id, ids[0]!, true)).status).toBe(409); // closed
});

test('another learner gets 404 on GET, PUT and submit', async () => {
  const { agent, content, app, db } = await setup();
  const a = await start(agent, { kind: 'domain', scope: '1' });
  const ids = idsOf((await agent.get(`/api/assessments/${a.body.id}`)).body);
  const other = await loginAs(app, await createUser(db));
  expect((await other.get(`/api/assessments/${a.body.id}`)).status).toBe(404);
  expect((await put(other, content, a.body.id, ids[0]!, true)).status).toBe(404);
  expect((await other.post(`/api/assessments/${a.body.id}/submit`)).status).toBe(404);
  expect((await other.get('/api/assessments/99999')).status).toBe(404);
  expect((await other.get('/api/assessments/abc')).status).toBe(404);
});

test('unauthenticated requests are rejected', async () => {
  const { app } = await setup();
  const request = (await import('supertest')).default;
  expect((await request(app).get('/api/assessments/1')).status).toBe(401);
});

test('PUT for a questionId not in the assessment returns 400', async () => {
  const { agent, content } = await setup();
  const a = await start(agent, { kind: 'domain', scope: '1' });
  const res = await agent.put(`/api/assessments/${a.body.id}/answers`).send({ questionId: 'lab-1-01-s1', answer: { type: 'single', choice: 'a' } });
  expect(res.status).toBe(400);
  expect((await agent.put(`/api/assessments/${a.body.id}/answers`).send({ questionId: 'nope', flagged: true })).status).toBe(400);
});

test('if a stored question id no longer exists in content, GET omits it and submit scores the rest (no 500)', async () => {
  const { agent, content, db } = await setup();
  const a = await start(agent, { kind: 'domain', scope: '1' });
  const ids = idsOf((await agent.get(`/api/assessments/${a.body.id}`)).body);
  await answer(agent, content, a.body.id, ids, 3);
  await db.exec("UPDATE assessments SET question_ids = JSON_ARRAY_APPEND(question_ids, '$', 'q-gone-001') WHERE id = ?", [a.body.id]);
  await db.exec("UPDATE assessments SET answers = JSON_SET(answers, '$.\"q-gone-001\"', JSON_OBJECT('type', 'single', 'choice', 'a')) WHERE id = ?", [a.body.id]);
  // a stored answer whose shape no longer matches its question counts as wrong
  await db.exec("UPDATE assessments SET answers = JSON_SET(answers, ?, JSON_OBJECT('type', 'order', 'order', JSON_ARRAY('zz'))) WHERE id = ?", [`$."${ids[0]}"`, a.body.id]);
  const got = await agent.get(`/api/assessments/${a.body.id}`);
  expect(got.status).toBe(200);
  expect(idsOf(got.body)).toEqual(ids);
  expect(got.body.answers['q-gone-001']).toBeUndefined();
  const res = await agent.post(`/api/assessments/${a.body.id}/submit`);
  expect(res.status).toBe(200);
  expect(res.body.result.scorePct).toBe(8.33); // 2 of 24
});

test('domain exam for a locked domain returns 403; unknown scope 404', async () => {
  const { agent } = await setup();
  expect((await start(agent, { kind: 'domain', scope: '2' })).status).toBe(403);
  expect((await start(agent, { kind: 'domain', scope: '9' })).status).toBe(404);
  expect((await start(agent, { kind: 'objective', scope: '9.9' })).status).toBe(404);
  expect((await start(agent, { kind: 'objective', scope: '2.1' })).status).toBe(404); // unpublished
  expect((await start(agent, { kind: 'objective' })).status).toBe(400);
  expect((await start(agent, { kind: 'bogus' })).status).toBe(400);
});

test('an unlocked domain with no published objective returns 404', async () => {
  const { agent, db, user } = await setup();
  await db.exec(
    `INSERT INTO assessments (user_id, kind, scope, question_ids, answers, flags, started_at, submitted_at, passed)
     VALUES (?, 'domain', '1', '[]', '{}', '[]', ?, ?, 1)`,
    [user.id, t0, t0],
  );
  expect((await start(agent, { kind: 'domain', scope: '2' })).status).toBe(404);
});
