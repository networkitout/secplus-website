import request from 'supertest';
import { CSRF_HEADER, CSRF_VALUE } from '../../http.js';
import { createUser, loginAs, testApp } from '../../test/helpers.js';

const T0 = new Date('2026-11-10T12:00:00Z');

async function setup() {
  const t = await testApp({ now: () => T0 });
  t.setNow(T0);
  const admin = await createUser(t.db, { login: 'boss', role: 'admin' });
  const learner = await createUser(t.db, { login: 'alice', name: 'Alice' });
  return { ...t, admin, learner };
}

async function insertAssessment(db: any, o: { userId: number; kind: string; scope?: string | null; passed?: boolean; scaled?: number | null; submittedAt: Date | null }) {
  await db.exec(
    `INSERT INTO assessments (user_id, kind, scope, question_ids, answers, flags, started_at, submitted_at, scaled_score, passed)
     VALUES (?, ?, ?, '[]', '{}', '[]', ?, ?, ?, ?)`,
    [o.userId, o.kind, o.scope ?? null, T0, o.submittedAt, o.scaled ?? null, o.passed === undefined ? null : o.passed ? 1 : 0],
  );
}

describe('admin API', () => {
  test('learner gets 403 on every admin route; anonymous gets 401', async () => {
    const { app, learner, admin } = await setup();
    const agent = await loginAs(app, learner);
    const calls = [
      () => agent.get('/api/admin/users'),
      () => agent.post('/api/admin/invites').send({ purpose: 'invite' }),
      () => agent.patch(`/api/admin/users/${admin.id}`).send({ active: false }),
    ];
    for (const c of calls) expect((await c()).status).toBe(403);
    const h = (r: request.Test) => r.set(CSRF_HEADER, CSRF_VALUE);
    expect((await h(request(app).get('/api/admin/users'))).status).toBe(401);
    expect((await h(request(app).post('/api/admin/invites')).send({ purpose: 'invite' })).status).toBe(401);
    expect((await h(request(app).patch(`/api/admin/users/${learner.id}`)).send({ active: false })).status).toBe(401);
  });

  test('invite url token is accepted by accept-invite', async () => {
    const { app, admin } = await setup();
    const agent = await loginAs(app, admin);
    const res = await agent.post('/api/admin/invites').send({ purpose: 'invite' });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/invite\/[^/]+$/);
    expect(res.body.expiresAt).toBe(new Date(T0.getTime() + 7 * 86_400_000).toISOString());
    const token = res.body.url.split('/')[2];
    const accept = await request(app)
      .post('/api/auth/accept-invite')
      .set(CSRF_HEADER, CSRF_VALUE)
      .send({ token, login: 'newbie', name: 'Newbie', password: 'a-long-enough-password' });
    expect(accept.status).toBe(200);
    expect(accept.body.user.login).toBe('newbie');
  });

  test('reset invite requires an existing userId (404 otherwise)', async () => {
    const { app, admin, learner, db } = await setup();
    const agent = await loginAs(app, admin);
    const ok = await agent.post('/api/admin/invites').send({ purpose: 'reset', userId: learner.id });
    expect(ok.status).toBe(200);
    expect(ok.body.url).toMatch(/^\/reset\/[^/]+$/);
    const reset = await request(app)
      .post('/api/auth/reset')
      .set(CSRF_HEADER, CSRF_VALUE)
      .send({ token: ok.body.url.split('/')[2], password: 'another-long-password' });
    expect(reset.status).toBe(200);
    expect((await agent.post('/api/admin/invites').send({ purpose: 'reset', userId: 99999 })).status).toBe(404);
    const gone = await createUser(db, { login: 'gone', active: false });
    expect((await agent.post('/api/admin/invites').send({ purpose: 'reset', userId: gone.id })).status).toBe(404);
    expect((await agent.post('/api/admin/invites').send({ purpose: 'reset' })).status).toBe(400);
    expect((await agent.post('/api/admin/invites').send({ purpose: 'bogus' })).status).toBe(400);
  });

  test('deactivating a user deletes their sessions and blocks login', async () => {
    const { app, admin, learner, db } = await setup();
    const learnerAgent = await loginAs(app, learner);
    expect((await learnerAgent.get('/api/auth/me')).status).toBe(200);
    const agent = await loginAs(app, admin);
    const res = await agent.patch(`/api/admin/users/${learner.id}`).send({ active: false });
    expect(res.status).toBe(200);
    const sessions = await db.query('SELECT 1 FROM sessions WHERE user_id = ?', [learner.id]);
    expect(sessions).toHaveLength(0);
    expect((await learnerAgent.get('/api/auth/me')).status).toBe(401);
    const login = await request(app)
      .post('/api/auth/login')
      .set(CSRF_HEADER, CSRF_VALUE)
      .send({ login: learner.login, password: learner.password });
    expect(login.status).toBe(401);
    // reactivation restores login
    expect((await agent.patch(`/api/admin/users/${learner.id}`).send({ active: true })).status).toBe(200);
    await loginAs(app, learner);
  });

  test('an admin cannot deactivate themselves (400)', async () => {
    const { app, admin } = await setup();
    const agent = await loginAs(app, admin);
    expect((await agent.patch(`/api/admin/users/${admin.id}`).send({ active: false })).status).toBe(400);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  test('unknown id is 404, non-numeric id and bad body are 400', async () => {
    const { app, admin } = await setup();
    const agent = await loginAs(app, admin);
    expect((await agent.patch('/api/admin/users/99999').send({ active: false })).status).toBe(404);
    expect((await agent.patch('/api/admin/users/abc').send({ active: false })).status).toBe(400);
    expect((await agent.patch(`/api/admin/users/${admin.id + 1}`).send({ active: 'no' })).status).toBe(400);
  });

  test('users list includes domainsPassed and latestMockScore from assessments, and never password_hash', async () => {
    const { app, admin, learner, db } = await setup();
    const d = (n: number) => new Date(T0.getTime() + n * 60_000);
    await insertAssessment(db, { userId: learner.id, kind: 'domain', scope: '3', passed: true, submittedAt: d(1) });
    await insertAssessment(db, { userId: learner.id, kind: 'domain', scope: '3', passed: true, submittedAt: d(2) });
    await insertAssessment(db, { userId: learner.id, kind: 'domain', scope: '1', passed: true, submittedAt: d(3) });
    await insertAssessment(db, { userId: learner.id, kind: 'domain', scope: '2', passed: false, submittedAt: d(4) });
    await insertAssessment(db, { userId: learner.id, kind: 'domain', scope: '4', passed: null as any, submittedAt: null });
    await insertAssessment(db, { userId: learner.id, kind: 'mock', passed: false, scaled: 640, submittedAt: d(5) });
    await insertAssessment(db, { userId: learner.id, kind: 'mock', passed: true, scaled: 780, submittedAt: d(10) });
    await insertAssessment(db, { userId: learner.id, kind: 'mock', scaled: null, submittedAt: null });
    const agent = await loginAs(app, admin);
    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    const byLogin = Object.fromEntries(res.body.users.map((u: any) => [u.login, u]));
    expect(byLogin.alice).toEqual({
      id: learner.id,
      login: 'alice',
      name: 'Alice',
      role: 'learner',
      active: true,
      lastActiveAt: null,
      domainsPassed: [1, 3],
      latestMockScore: 780,
    });
    expect(byLogin.boss.domainsPassed).toEqual([]);
    expect(byLogin.boss.latestMockScore).toBeNull();
    expect(typeof byLogin.boss.lastActiveAt).toBe('string');
  });
});
