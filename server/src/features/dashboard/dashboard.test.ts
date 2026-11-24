import { expect, test, vi } from 'vitest';
import type { Answer, Question } from '../../../../shared/types.js';
import { BADGES } from '../../services/xp.js';
import { CSRF_HEADER, CSRF_VALUE } from '../../http.js';
import { pickMock, seededRng } from '../../services/assembler.js';
import { createUser, loginAs, testApp } from '../../test/helpers.js';
import { mockSpec } from '../assessments/repo.js';

const t0 = new Date('2026-11-10T12:00:00Z');

async function setup(timeZone = 'UTC') {
  const t = await testApp({ now: () => t0 });
  const user = await createUser(t.db, { timeZone });
  const agent = await loginAs(t.app, user);
  return { ...t, user, agent };
}

function rightAnswer(q: Question): Answer {
  switch (q.type) {
    case 'single':
      return { type: 'single', choice: q.correct };
    case 'multi':
      return { type: 'multi', choices: [...q.correct] };
    case 'order':
      return { type: 'order', order: [...q.correct] };
    case 'match':
      return { type: 'match', pairs: { ...q.correct } };
    case 'categorize':
      return { type: 'categorize', placements: { ...q.correct } };
  }
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function attempt(db: Setup['db'], userId: number, questionId: string, correct: boolean, at: Date, context = 'quiz') {
  await db.exec('INSERT INTO attempts (user_id, question_id, correct, context, created_at) VALUES (?, ?, ?, ?, ?)', [
    userId,
    questionId,
    correct ? 1 : 0,
    context,
    at,
  ]);
}
const at = (n: number) => new Date(t0.getTime() - (100 - n) * 60_000);

/** Submits an assessment with every question answered correctly. */
async function passAssessment(s: Setup, body: object) {
  const a = await s.agent.post('/api/assessments').send(body);
  expect(a.status).toBe(201);
  const got = await s.agent.get(`/api/assessments/${a.body.id}`);
  for (const q of got.body.questions) {
    const full = s.content.questions.get(q.id)!;
    const res = await s.agent.put(`/api/assessments/${a.body.id}/answers`).send({ questionId: q.id, answer: rightAnswer(full) });
    expect(res.status).toBe(200);
  }
  const sub = await s.agent.post(`/api/assessments/${a.body.id}/submit`);
  expect(sub.body.result.passed).toBe(true);
  return a.body.id as number;
}

test('path: new learner sees domain 1 unlocked, domain 2 locked and hasContent false, objective flags false', async () => {
  const { agent } = await setup();
  const res = await agent.get('/api/path');
  expect(res.status).toBe(200);
  const [d1, d2] = res.body.domains;
  expect(d1).toMatchObject({ id: 1, weight: 50, unlocked: true, examPassed: false, hasContent: true });
  expect(d2).toMatchObject({ id: 2, unlocked: false, examPassed: false, hasContent: false });
  expect(d1.objectives).toEqual([
    { id: '1.1', title: 'Fixture objective one', published: true, lessonDone: false, quizPassed: false, mastery: 0 },
    { id: '1.2', title: 'Fixture objective two', published: true, lessonDone: false, quizPassed: false, mastery: 0 },
  ]);
  expect(d2.objectives[0]).toMatchObject({ id: '2.1', published: false, mastery: 0 });
});

test('path requires a session', async () => {
  const { app } = await setup();
  const { default: request } = await import('supertest');
  expect((await request(app).get('/api/path')).status).toBe(401);
});

test('path reflects lessonDone, quizPassed and mastery after activity', async () => {
  const s = await setup();
  await s.db.exec('INSERT INTO lesson_progress (user_id, objective, sections_done, completed_at) VALUES (?, ?, ?, ?)', [s.user.id, '1.1', '[]', t0]);
  await s.db.exec('INSERT INTO lesson_progress (user_id, objective, sections_done, completed_at) VALUES (?, ?, ?, NULL)', [s.user.id, '1.2', '[]']);
  await passAssessment(s, { kind: 'objective', scope: '1.1' });
  const ids12 = s.content.questionsFor('1.2').map((q) => q.id);
  for (const id of ids12.slice(0, 3)) await attempt(s.db, s.user.id, id, true, at(1));
  const [d1] = (await s.agent.get('/api/path')).body.domains;
  const [o11, o12] = d1.objectives;
  expect(o11).toMatchObject({ lessonDone: true, quizPassed: true });
  expect(o11.mastery).toBeGreaterThan(0); // the 10 quiz answers were all right: 10 of 12
  expect(o12).toMatchObject({ lessonDone: false, quizPassed: false, mastery: 25 }); // 3 of 12
});

test('path: passing the domain 1 exam unlocks domain 2 and marks examPassed', async () => {
  const s = await setup();
  await passAssessment(s, { kind: 'domain', scope: '1' });
  const [d1, d2] = (await s.agent.get('/api/path')).body.domains;
  expect(d1.examPassed).toBe(true);
  expect(d2).toMatchObject({ unlocked: true, examPassed: false, hasContent: false });
});

test('dashboard for a brand-new learner returns zeros, empty arrays, readiness.ready false, all badges unearned (no 500)', async () => {
  const { agent } = await setup();
  const res = await agent.get('/api/dashboard');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    xp: 0,
    level: 1,
    nextLevelXp: 100,
    streak: 0,
    reviewsDue: 0,
    weakest: [],
    mockHistory: [],
    openMock: null,
    studyPlan: null,
  });
  expect(res.body.domains).toEqual([
    { id: 1, title: 'Fixture Domain One', mastery: 0 },
    { id: 2, title: 'Fixture Domain Two', mastery: 0 },
  ]);
  expect(res.body.readiness.ready).toBe(false);
  expect(res.body.readiness.missing[0]).toBe('Content for all five domains is not available yet');
  expect(res.body.badges).toEqual(BADGES.map((b) => ({ ...b, earnedAt: null })));
});

const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);

test('path: openExam reports the learner\'s own open domain exam, and never an expired or another learner\'s one', async () => {
  const s = await setup();
  const other = await loginAs(s.app, await createUser(s.db));
  const openExams = async (agent = s.agent) => (await agent.get('/api/path')).body.domains.map((d: any) => d.openExam);
  expect(await openExams()).toEqual([null, null]);

  const a = await s.agent.post('/api/assessments').send({ kind: 'domain', scope: '1' });
  expect(a.status).toBe(201);
  // A quiz or a mock exam in progress is not a domain exam.
  await s.agent.post('/api/assessments').send({ kind: 'objective', scope: '1.1' });
  await s.agent.post('/api/assessments').send({ kind: 'mock' });
  expect(await openExams()).toEqual([{ id: a.body.id, deadlineAt: minutes(25).toISOString() }, null]);
  expect(await openExams(other)).toEqual([null, null]);

  s.setNow(minutes(25)); // exactly at the deadline it is still open
  expect((await openExams())[0]).toEqual({ id: a.body.id, deadlineAt: minutes(25).toISOString() });
  // Past the deadline it is closed and scored, as on any other access, and no longer offered.
  s.setNow(minutes(26));
  expect(await openExams()).toEqual([null, null]);
  const [row] = await s.db.query('SELECT submitted_at, passed FROM assessments WHERE id = ?', [a.body.id]);
  expect(row.submitted_at).toEqual(minutes(26));
  expect(row.passed).toBe(0);
});

test('path: a submitted domain exam is not open', async () => {
  const s = await setup();
  await passAssessment(s, { kind: 'domain', scope: '1' });
  const [d1, d2] = (await s.agent.get('/api/path')).body.domains;
  expect(d1).toMatchObject({ examPassed: true, openExam: null });
  expect(d2).toMatchObject({ unlocked: true, openExam: null });
});

test('dashboard: openMock reports the learner\'s own open mock exam, and never an expired or another learner\'s one', async () => {
  const s = await setup();
  const other = await loginAs(s.app, await createUser(s.db));
  const dash = async (agent = s.agent) => (await agent.get('/api/dashboard')).body;
  expect((await dash()).openMock).toBeNull();

  await s.agent.post('/api/assessments').send({ kind: 'domain', scope: '1' }); // not a mock
  expect((await dash()).openMock).toBeNull();
  const a = await s.agent.post('/api/assessments').send({ kind: 'mock' });
  expect(a.status).toBe(201);
  expect((await dash()).openMock).toEqual({ id: a.body.id, deadlineAt: minutes(4).toISOString() });
  expect((await dash(other)).openMock).toBeNull();

  // Past its deadline the mock is closed and scored, and shows up in the history instead.
  s.setNow(minutes(5));
  const after = await dash();
  expect(after.openMock).toBeNull();
  expect(after.mockHistory).toEqual([{ id: a.body.id, submittedAt: minutes(5).toISOString(), scaledScore: 100, passed: false, partial: true }]);
  expect((await dash(other)).mockHistory).toEqual([]);
});

test('dashboard: a submitted mock is not open', async () => {
  const s = await setup();
  await passAssessment(s, { kind: 'mock' });
  const body = (await s.agent.get('/api/dashboard')).body;
  expect(body.openMock).toBeNull();
  expect(body.mockHistory).toHaveLength(1);
});

test('dashboard: mockSpec states what a mock exam started now would be', async () => {
  const s = await setup();
  // The fixture publishes domain 1 only, whose mock share is 4 questions: a partial exam of 4 minutes.
  expect((await s.agent.get('/api/dashboard')).body.mockSpec).toEqual({ questions: 4, minutes: 4, partial: true });
  const started = await s.agent.post('/api/assessments').send({ kind: 'mock' });
  const view = (await s.agent.get(`/api/assessments/${started.body.id}`)).body;
  expect(view.questions).toHaveLength(4);
  expect(view.deadlineAt).toBe(minutes(4).toISOString());

  s.content.manifest.domains.splice(1); // every remaining domain has content: a full exam
  expect((await s.agent.get('/api/dashboard')).body.mockSpec).toEqual({ questions: 4, minutes: 4, partial: false });
  for (const d of s.content.manifest.domains) for (const o of d.objectives) o.published = false;
  expect((await s.agent.get('/api/dashboard')).body.mockSpec).toEqual({ questions: 0, minutes: 0, partial: true });
});

test('mockSpec gives the counts that assembling a mock gives, without assembling one', async () => {
  const { content } = await setup();
  const assembled = () => {
    const m = pickMock(content, new Map(), seededRng('any'));
    return { questions: m.questionIds.length, minutes: m.minutes, partial: m.partial };
  };
  expect(mockSpec(content)).toEqual(assembled());
  expect(mockSpec(content)).toEqual({ questions: 4, minutes: 4, partial: true });
  // A domain that asks for more questions than it has gives what it has.
  content.manifest.domains[0]!.mockCount = 30;
  expect(mockSpec(content)).toEqual(assembled());
  expect(mockSpec(content)).toEqual({ questions: 24, minutes: 24, partial: true });
  // One objective unpublished: its questions are out of the pool.
  content.manifest.domains[0]!.objectives[1]!.published = false;
  expect(mockSpec(content)).toEqual(assembled());
  expect(mockSpec(content).questions).toBe(12);
  content.manifest.domains.splice(1);
  expect(mockSpec(content)).toEqual(assembled());
  expect(mockSpec(content).partial).toBe(false);
});

test('a failure while closing an expired exam does not fail the dashboard or the path; the exam is closed by a later request', async () => {
  const s = await setup();
  const mock = await s.agent.post('/api/assessments').send({ kind: 'mock' });
  const exam = await s.agent.post('/api/assessments').send({ kind: 'domain', scope: '1' });
  s.setNow(minutes(30)); // both are past their deadlines
  const submitted = async () =>
    (await s.db.query<{ submitted_at: Date | null }>('SELECT submitted_at FROM assessments WHERE id IN (?, ?) ORDER BY id', [mock.body.id, exam.body.id])).map(
      (r) => r.submitted_at !== null,
    );

  // Closing an exam runs in a transaction; this one fails the way a deadlock does.
  const tx = s.db.tx;
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  s.db.tx = async () => {
    throw Object.assign(new Error('Deadlock found when trying to get lock; try restarting transaction'), { code: 'ER_LOCK_DEADLOCK' });
  };
  try {
    const dash = await s.agent.get('/api/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.openMock).toBeNull();
    expect(dash.body.mockHistory).toEqual([]);
    const path = await s.agent.get('/api/path');
    expect(path.status).toBe(200);
    expect(path.body.domains[0]).toMatchObject({ openExam: null, examPassed: false });
    // Each failure is logged like any other unexpected server error.
    expect(logged).toHaveBeenCalledTimes(2);
    // ... and says which exam of which learner could not be closed.
    const lines = logged.mock.calls.map((args) => String(args[0]));
    expect(lines[0]).toContain(`Closing expired assessment ${mock.body.id} of user ${s.user.id} failed`);
    expect(lines[0]).toContain('[ER_LOCK_DEADLOCK]');
    expect(lines[0]).toContain('Deadlock');
    expect(lines[1]).toContain(`Closing expired assessment ${exam.body.id} of user ${s.user.id} failed`);
  } finally {
    s.db.tx = tx;
    logged.mockRestore();
  }
  expect(await submitted()).toEqual([false, false]);

  const later = await s.agent.get('/api/dashboard');
  expect(later.body.openMock).toBeNull();
  expect(later.body.mockHistory.map((m: any) => m.id)).toEqual([mock.body.id]);
  expect((await s.agent.get('/api/path')).body.domains[0].openExam).toBeNull();
  expect(await submitted()).toEqual([true, true]);
});

test('dashboard mastery, weakest, level, badges and study plan reflect activity', async () => {
  const s = await setup();
  const q11 = s.content.questionsFor('1.1').map((q) => q.id);
  const q12 = s.content.questionsFor('1.2').map((q) => q.id);
  for (const id of q11.slice(0, 6)) await attempt(s.db, s.user.id, id, true, at(1)); // 6 of 12 known
  for (const id of q12.slice(0, 3)) await attempt(s.db, s.user.id, id, true, at(1));
  for (const id of q12.slice(0, 3)) await attempt(s.db, s.user.id, id, false, at(2)); // latest attempt wins: none known
  await attempt(s.db, s.user.id, q12[5]!, true, at(3), 'lab'); // lab attempts are ignored
  await s.db.exec('INSERT INTO xp_events (user_id, amount, reason, ref, created_at) VALUES (?, 250, ?, ?, ?)', [s.user.id, 'test', 'x', t0]);
  await s.db.exec('INSERT INTO badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)', [s.user.id, 'first-lesson', t0]);
  await s.agent.put('/api/settings').send({ examDate: '2026-11-20' });

  const res = await s.agent.get('/api/dashboard');
  expect(res.body).toMatchObject({ xp: 250, level: 2, nextLevelXp: 400 });
  expect(res.body.domains).toEqual([
    { id: 1, title: 'Fixture Domain One', mastery: 25 }, // (50 * 12 + 0 * 12) / 24
    { id: 2, title: 'Fixture Domain Two', mastery: 0 },
  ]);
  expect(res.body.weakest).toEqual([
    { objective: '1.2', title: 'Fixture objective two', mastery: 0 },
    { objective: '1.1', title: 'Fixture objective one', mastery: 50 },
  ]);
  expect(res.body.badges.find((b: any) => b.id === 'first-lesson').earnedAt).toBe(t0.toISOString());
  expect(res.body.badges.filter((b: any) => b.earnedAt === null)).toHaveLength(BADGES.length - 1);
  expect(res.body.studyPlan).toMatchObject({ daysLeft: 10, objectivesPerDay: 1 }); // 3 manifest objectives, none passed
});

test('dashboard mockHistory only includes submitted mocks, newest last; readiness uses only non-partial mocks', async () => {
  const s = await setup();
  const insert = (submitted: Date | null, scaled: number | null, partial: boolean) =>
    s.db.exec(
      "INSERT INTO assessments (user_id, kind, question_ids, answers, flags, started_at, submitted_at, scaled_score, passed, breakdown) VALUES (?, 'mock', '[]', '{}', '[]', ?, ?, ?, ?, ?)",
      [s.user.id, at(0), submitted, scaled, scaled === null ? null : scaled >= 750 ? 1 : 0, JSON.stringify({ partial })],
    );
  await insert(at(40), 900, true); // partial
  await insert(at(10), 700, false);
  await insert(at(20), 820, false);
  await insert(null, null, false); // still open
  await insert(at(30), 760, false);
  const res = await s.agent.get('/api/dashboard');
  expect(res.body.mockHistory.map((m: any) => [m.scaledScore, m.partial, m.passed])).toEqual([
    [700, false, false],
    [820, false, true],
    [760, false, true],
    [900, true, true],
  ]);
  expect(res.body.mockHistory[0].submittedAt).toBe(at(10).toISOString());
  // three non-partial mocks: mean (760 + 820 + 700) / 3 = 760, so the average line appears and the mock-count line does not
  expect(res.body.readiness.missing).toContain('Average of last three mock exams is 760; aim for 800');
  expect(res.body.readiness.missing.some((m: string) => m.startsWith('Take '))).toBe(false);
});

test('dashboard readiness counts only non-partial mocks toward the three needed', async () => {
  const s = await setup();
  for (const [n, partial] of [[10, true], [20, true], [30, false]] as const) {
    await s.db.exec(
      "INSERT INTO assessments (user_id, kind, question_ids, answers, flags, started_at, submitted_at, scaled_score, passed, breakdown) VALUES (?, 'mock', '[]', '{}', '[]', ?, ?, 800, 1, ?)",
      [s.user.id, at(0), at(n), JSON.stringify({ partial })],
    );
  }
  const res = await s.agent.get('/api/dashboard');
  expect(res.body.mockHistory).toHaveLength(3);
  expect(res.body.readiness.missing).toContain('Take 2 more mock exams');
});

test('dashboard ignores attempts whose question id no longer exists in content', async () => {
  const s = await setup();
  await attempt(s.db, s.user.id, 'q-9.9-001', true, at(1));
  await attempt(s.db, s.user.id, 'q-9.9-002', false, at(1));
  const res = await s.agent.get('/api/dashboard');
  expect(res.status).toBe(200);
  expect(res.body.weakest).toEqual([]);
  expect(res.body.domains.every((d: any) => d.mastery === 0)).toBe(true);
});

test("dashboard never includes another learner's data (two users with different activity)", async () => {
  const s = await setup();
  const other = await createUser(s.db);
  const otherAgent = await loginAs(s.app, other);
  for (const q of s.content.questionsFor('1.1')) await attempt(s.db, other.id, q.id, true, at(1));
  await s.db.exec('INSERT INTO xp_events (user_id, amount, reason, ref, created_at) VALUES (?, 500, ?, ?, ?)', [other.id, 'test', 'x', t0]);
  await s.db.exec('INSERT INTO badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)', [other.id, 'first-lesson', t0]);

  const mine = await s.agent.get('/api/dashboard');
  expect(mine.body.xp).toBe(0);
  expect(mine.body.weakest).toEqual([]);
  expect(mine.body.badges.every((b: any) => b.earnedAt === null)).toBe(true);
  const theirs = await otherAgent.get('/api/dashboard');
  expect(theirs.body.xp).toBe(500);
  expect(theirs.body.domains[0].mastery).toBe(50);
  const theirPath = await otherAgent.get('/api/path');
  expect(theirPath.body.domains[0].objectives[0].mastery).toBe(100);
  expect((await s.agent.get('/api/path')).body.domains[0].objectives[0].mastery).toBe(0);
});

// ---------------------------------------------------------------- practice

test('practice returns only wrong-or-unseen questions with no answer data', async () => {
  const s = await setup();
  const ids = s.content.questionsFor('1.1').map((q) => q.id); // 12 questions
  for (const id of ids.slice(0, 5)) await attempt(s.db, s.user.id, id, true, at(1)); // known
  await attempt(s.db, s.user.id, ids[0]!, false, at(2)); // now wrong again
  await attempt(s.db, s.user.id, ids[7]!, false, at(1)); // wrong
  const res = await s.agent.get('/api/practice/1.1');
  expect(res.status).toBe(200);
  const got: string[] = res.body.questions.map((q: any) => q.id);
  expect(got).toHaveLength(8); // 12 questions minus the 4 whose latest attempt is correct
  expect(got.slice(0, 2).sort()).toEqual([ids[0]!, ids[7]!].sort()); // wrong-latest first
  for (const known of ids.slice(1, 5)) expect(got).not.toContain(known);
  expect(new Set(got).size).toBe(8);
  const text = JSON.stringify(res.body);
  for (const k of ['"correct"', '"explanation"', '"why"']) expect(text).not.toContain(k);
});

test('practice: unknown or unpublished objective 404, locked domain 403, requires session', async () => {
  const s = await setup();
  expect((await s.agent.get('/api/practice/9.9')).status).toBe(404);
  expect((await s.agent.get('/api/practice/2.1')).status).toBe(404);
  const empty = await s.agent.get('/api/practice/1.2');
  expect(empty.body.questions).toHaveLength(10);
  const { default: request } = await import('supertest');
  expect((await request(s.app).get('/api/practice/1.1')).status).toBe(401);
});

// ---------------------------------------------------------------- settings

test('settings: invalid time zone -> 400; examDate not YYYY-MM-DD -> 400; name over 64 chars -> 400; hideFromLeaderboard persists', async () => {
  const { agent, db, user } = await setup();
  const bad = async (body: object) => expect((await agent.put('/api/settings').send(body)).status).toBe(400);
  await bad({ timeZone: 'Mars/Olympus' });
  await bad({ timeZone: '+05:00' });
  await bad({ examDate: '11/20/2026' });
  await bad({ examDate: '2026-02-30' });
  await bad({ examDate: '2026-1-5' });
  await bad({ name: 'x'.repeat(65) });
  await bad({ name: '   ' });
  await bad({ hideFromLeaderboard: 'yes' });
  await bad({ role: 'admin' });
  const [row] = await db.query<any>('SELECT name, time_zone, exam_date FROM users WHERE id = ?', [user.id]);
  expect(row.time_zone).toBe('UTC'); // nothing changed by the rejected requests
  expect(row.exam_date).toBeNull();

  const ok = await agent.put('/api/settings').send({ name: '  Ada  ', timeZone: 'America/New_York', examDate: '2026-12-01', hideFromLeaderboard: true });
  expect(ok.status).toBe(200);
  expect(ok.body.user).toMatchObject({
    id: user.id,
    login: user.login,
    name: 'Ada',
    role: 'learner',
    timeZone: 'America/New_York',
    examDate: '2026-12-01',
    hideFromLeaderboard: true,
  });
  const me = await agent.get('/api/auth/me');
  expect(me.body.user).toEqual(ok.body.user);
  // partial update keeps the rest; null clears the exam date
  const partial = await agent.put('/api/settings').send({ examDate: null });
  expect(partial.body.user).toMatchObject({ name: 'Ada', examDate: null, hideFromLeaderboard: true });
  expect((await agent.put('/api/settings').send({ hideFromLeaderboard: false })).body.user.hideFromLeaderboard).toBe(false);
});

test('settings rejects requests without a session', async () => {
  const { app } = await setup();
  const { default: request } = await import('supertest');
  expect((await request(app).put('/api/settings').set(CSRF_HEADER, CSRF_VALUE).send({})).status).toBe(401);
});
