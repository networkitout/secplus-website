import bcrypt from 'bcryptjs';
import request from 'supertest';
import { CSRF_HEADER, CSRF_VALUE } from '../../http.js';
import { createUser, testApp } from '../../test/helpers.js';
import { createInvite, ensureAdmin } from './repo.js';
import { hashToken } from './tokens.js';

const post = (app: any, url: string, body: unknown) => request(app).post(url).set(CSRF_HEADER, CSRF_VALUE).send(body as object);
const T0 = new Date('2026-11-10T12:00:00Z');
const MIN = 60_000;

async function setup() {
  const t = await testApp({ now: () => T0 });
  t.setNow(T0);
  return t;
}

describe('login', () => {
  test('valid login sets HttpOnly SameSite=Lax sid cookie and returns user without password_hash', async () => {
    const { app, db } = await setup();
    const u = await createUser(db, { login: 'alice', name: 'Alice', timeZone: 'America/Chicago' });
    const res = await post(app, '/api/auth/login', { login: 'ALICE', password: u.password });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: u.id, login: 'alice', name: 'Alice', role: 'learner', timeZone: 'America/Chicago' });
    expect(JSON.stringify(res.body)).not.toContain('password');
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toMatch(/^sid=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Secure');
  });

  test('wrong password and unknown login both return 401 with identical body', async () => {
    const { app, db } = await setup();
    await createUser(db, { login: 'bob' });
    const a = await post(app, '/api/auth/login', { login: 'bob', password: 'nope-nope-nope' });
    const b = await post(app, '/api/auth/login', { login: 'ghost', password: 'nope-nope-nope' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual({ error: 'Invalid login or password' });
    expect(b.body).toEqual(a.body);
  });

  test('inactive user cannot log in (401)', async () => {
    const { app, db } = await setup();
    const u = await createUser(db, { login: 'carl', active: false });
    const res = await post(app, '/api/auth/login', { login: 'carl', password: u.password });
    expect(res.status).toBe(401);
  });

  test('6th failed attempt for one login within 15 minutes returns 429, and a correct password is also refused until the window passes (advance now by 15 min -> 200)', async () => {
    const { app, db, setNow } = await setup();
    const u = await createUser(db, { login: 'dana' });
    for (let i = 0; i < 5; i++) {
      expect((await post(app, '/api/auth/login', { login: 'dana', password: 'wrong-wrong-wrong' })).status).toBe(401);
    }
    expect((await post(app, '/api/auth/login', { login: 'dana', password: 'wrong-wrong-wrong' })).status).toBe(429);
    expect((await post(app, '/api/auth/login', { login: 'dana', password: u.password })).status).toBe(429);
    setNow(new Date(T0.getTime() + 15 * MIN));
    expect((await post(app, '/api/auth/login', { login: 'dana', password: u.password })).status).toBe(200);
  });

  test('me returns 401 without a cookie and the user with one', async () => {
    const { app, db } = await setup();
    const u = await createUser(db, { login: 'erin', name: 'Erin' });
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const agent = request.agent(app).set(CSRF_HEADER, CSRF_VALUE);
    await agent.post('/api/auth/login').send({ login: 'erin', password: u.password });
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: u.id, login: 'erin', name: 'Erin', role: 'learner' });
  });

  test('logout deletes the session row; the old cookie then gets 401', async () => {
    const { app, db } = await setup();
    const u = await createUser(db, { login: 'finn' });
    const login = await post(app, '/api/auth/login', { login: 'finn', password: u.password });
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0]!;
    expect(await db.query('SELECT 1 FROM sessions')).toHaveLength(1);
    const out = await request(app).post('/api/auth/logout').set(CSRF_HEADER, CSRF_VALUE).set('Cookie', cookie);
    expect(out.status).toBe(200);
    expect(await db.query('SELECT 1 FROM sessions')).toHaveLength(0);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  test('a session past expires_at gets 401', async () => {
    const { app, db, setNow } = await setup();
    const u = await createUser(db, { login: 'gus' });
    const login = await post(app, '/api/auth/login', { login: 'gus', password: u.password });
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0]!;
    setNow(new Date(T0.getTime() + 29 * 24 * 60 * MIN));
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
    // sliding: the 29-day touch pushed expiry to day 59
    setNow(new Date(T0.getTime() + 58 * 24 * 60 * MIN));
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
    setNow(new Date(T0.getTime() + 89 * 24 * 60 * MIN));
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  test('sessions table stores a 64-char hash, never the cookie value', async () => {
    const { app, db } = await setup();
    const u = await createUser(db, { login: 'hana' });
    const login = await post(app, '/api/auth/login', { login: 'hana', password: u.password });
    const value = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0]!.slice('sid='.length);
    const rows = await db.query<{ id_hash: string }>('SELECT id_hash FROM sessions');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id_hash).toHaveLength(64);
    expect(rows[0]!.id_hash).not.toBe(value);
    expect(rows[0]!.id_hash).toBe(hashToken(decodeURIComponent(value)));
  });
});

describe('csrf and headers', () => {
  test('POST without X-Requested-With returns 403', async () => {
    const { app, db } = await setup();
    const u = await createUser(db, { login: 'ivan' });
    const res = await request(app).post('/api/auth/login').send({ login: 'ivan', password: u.password });
    expect(res.status).toBe(403);
  });

  test('responses carry content-security-policy and x-content-type-options headers', async () => {
    const { app } = await setup();
    const res = await request(app).get('/api/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('invites', () => {
  const body = (token: string, extra: object = {}) => ({
    token,
    login: 'newbie',
    name: 'New Person',
    password: 'a-long-password-1',
    timeZone: 'Europe/Paris',
    ...extra,
  });

  async function adminAndInvite() {
    const t = await setup();
    const admin = await createUser(t.db, { login: 'boss', role: 'admin' });
    const token = await createInvite(t.db, { purpose: 'invite', createdBy: admin.id, now: T0 });
    return { ...t, admin, token };
  }

  test('accept-invite creates an active learner, marks the invite used, and logs them in', async () => {
    const { app, db, token } = await adminAndInvite();
    const info = await request(app).get(`/api/auth/invite/${token}`);
    expect(info.status).toBe(200);
    expect(info.body.purpose).toBe('invite');
    const agent = request.agent(app).set(CSRF_HEADER, CSRF_VALUE);
    const res = await agent.post('/api/auth/accept-invite').send(body(token));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ login: 'newbie', name: 'New Person', role: 'learner', timeZone: 'Europe/Paris' });
    const users = await db.query('SELECT * FROM users WHERE login = ?', ['newbie']);
    expect(users[0].active).toBe(1);
    const inv = await db.query('SELECT used_at FROM invites WHERE token_hash = ?', [hashToken(token)]);
    expect(inv[0].used_at).not.toBeNull();
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await request(app).get(`/api/auth/invite/${token}`)).status).toBe(410);
  });

  test('accept-invite rejects: used token (410), expired token (410), unknown token (404), password under 12 chars (400), taken login (409), invalid login characters (400)', async () => {
    const { app, db, admin, token, setNow } = await adminAndInvite();
    expect((await post(app, '/api/auth/accept-invite', body(token, { password: 'short' }))).status).toBe(400);
    expect((await post(app, '/api/auth/accept-invite', body(token, { login: 'Bad Login!' }))).status).toBe(400);
    expect((await post(app, '/api/auth/accept-invite', body('x'.repeat(43)))).status).toBe(404);
    await createUser(db, { login: 'taken' });
    expect((await post(app, '/api/auth/accept-invite', body(token, { login: 'taken' }))).status).toBe(409);
    // the failed attempts must not burn the invite
    expect((await post(app, '/api/auth/accept-invite', body(token))).status).toBe(200);
    expect((await post(app, '/api/auth/accept-invite', body(token, { login: 'other' }))).status).toBe(410);

    const t2 = await createInvite(db, { purpose: 'invite', createdBy: admin.id, now: T0 });
    setNow(new Date(T0.getTime() + 7 * 24 * 60 * MIN + 1));
    expect((await post(app, '/api/auth/accept-invite', body(t2, { login: 'late' }))).status).toBe(410);
    expect((await request(app).get(`/api/auth/invite/${t2}`)).status).toBe(410);
  });

  test('accept-invite with an invalid time zone stores UTC', async () => {
    const { app, db, token } = await adminAndInvite();
    const res = await post(app, '/api/auth/accept-invite', body(token, { timeZone: 'Mars/Olympus' }));
    expect(res.status).toBe(200);
    const rows = await db.query('SELECT time_zone FROM users WHERE login = ?', ['newbie']);
    expect(rows[0].time_zone).toBe('UTC');
  });

  test("reset changes the password, marks the token used, and deletes all of that user's sessions", async () => {
    const { app, db, admin } = await adminAndInvite();
    const u = await createUser(db, { login: 'resetme', name: 'Reset Me' });
    await post(app, '/api/auth/login', { login: 'resetme', password: u.password });
    await post(app, '/api/auth/login', { login: 'resetme', password: u.password });
    expect(await db.query('SELECT 1 FROM sessions WHERE user_id = ?', [u.id])).toHaveLength(2);
    const token = await createInvite(db, { purpose: 'reset', userId: u.id, createdBy: admin.id, now: T0 });
    const info = await request(app).get(`/api/auth/invite/${token}`);
    expect(info.body).toEqual({ purpose: 'reset', name: 'Reset Me' });
    const res = await post(app, '/api/auth/reset', { token, password: 'brand-new-password' });
    expect(res.status).toBe(200);
    expect(await db.query('SELECT 1 FROM sessions WHERE user_id = ?', [u.id])).toHaveLength(0);
    expect((await post(app, '/api/auth/login', { login: 'resetme', password: u.password })).status).toBe(401);
    expect((await post(app, '/api/auth/login', { login: 'resetme', password: 'brand-new-password' })).status).toBe(200);
    expect((await post(app, '/api/auth/reset', { token, password: 'another-new-password' })).status).toBe(410);
    expect((await post(app, '/api/auth/reset', { token: 'y'.repeat(43), password: 'another-new-password' })).status).toBe(404);
  });

  test('a reset token cannot be used on accept-invite and vice versa (404)', async () => {
    const { app, db, admin, token } = await adminAndInvite();
    const u = await createUser(db, { login: 'victim' });
    const resetToken = await createInvite(db, { purpose: 'reset', userId: u.id, createdBy: admin.id, now: T0 });
    expect((await post(app, '/api/auth/accept-invite', body(resetToken))).status).toBe(404);
    expect((await post(app, '/api/auth/reset', { token, password: 'brand-new-password' })).status).toBe(404);
  });

  test('invites table stores only token_hash', async () => {
    const { db, token } = await adminAndInvite();
    const cols = await db.query<{ c: string }>(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'invites'",
    );
    expect(cols.map((c) => c.c)).not.toContain('token');
    const rows = await db.query<{ token_hash: string; expires_at: Date }>('SELECT token_hash, expires_at FROM invites');
    expect(rows[0]!.token_hash).toBe(hashToken(token));
    expect(rows[0]!.token_hash).not.toBe(token);
    expect(rows[0]!.expires_at.getTime()).toBe(T0.getTime() + 7 * 24 * 60 * MIN);
  });
});

describe('hardening', () => {
  test('garbage token returns 404 on accept-invite and reset without hashing the password', async () => {
    const { app } = await setup();
    const spy = vi.spyOn(bcrypt, 'hash');
    try {
      const a = await post(app, '/api/auth/accept-invite', {
        token: 'g'.repeat(43), login: 'someone', name: 'S', password: 'a-long-password-1',
      });
      const r = await post(app, '/api/auth/reset', { token: 'g'.repeat(43), password: 'a-long-password-1' });
      expect([a.status, r.status]).toEqual([404, 404]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test('11th accept-invite/reset request from one IP in the window returns 429', async () => {
    const { app } = await setup();
    for (let i = 0; i < 10; i++) {
      const res = await post(app, i % 2 ? '/api/auth/reset' : '/api/auth/accept-invite', {
        token: 'g'.repeat(43), login: 'someone', name: 'S', password: 'a-long-password-1',
      });
      expect(res.status).toBe(404);
    }
    const res = await post(app, '/api/auth/reset', { token: 'g'.repeat(43), password: 'a-long-password-1' });
    expect(res.status).toBe(429);
  });

  test('an expired invite still returns 410 after another user logs in', async () => {
    const { app, db, setNow } = await setup();
    const admin = await createUser(db, { login: 'boss', role: 'admin' });
    const token = await createInvite(db, { purpose: 'invite', createdBy: admin.id, now: T0 });
    setNow(new Date(T0.getTime() + 8 * 24 * 60 * MIN));
    await post(app, '/api/auth/login', { login: 'boss', password: admin.password });
    expect((await request(app).get(`/api/auth/invite/${token}`)).status).toBe(410);
    setNow(new Date(T0.getTime() + 40 * 24 * 60 * MIN));
    await post(app, '/api/auth/login', { login: 'boss', password: admin.password });
    expect((await request(app).get(`/api/auth/invite/${token}`)).status).toBe(404);
  });

  test('passwords over 72 bytes are rejected with 400 on accept-invite and reset', async () => {
    const { app } = await setup();
    const long = 'p'.repeat(73);
    expect((await post(app, '/api/auth/accept-invite', { token: 't', login: 'abc', name: 'N', password: long })).status).toBe(400);
    expect((await post(app, '/api/auth/reset', { token: 't', password: long })).status).toBe(400);
  });

  test('reset returns 404 for an inactive user and leaves the token unused', async () => {
    const { app, db } = await setup();
    const admin = await createUser(db, { login: 'boss', role: 'admin' });
    const u = await createUser(db, { login: 'gone', active: false });
    const token = await createInvite(db, { purpose: 'reset', userId: u.id, createdBy: admin.id, now: T0 });
    expect((await post(app, '/api/auth/reset', { token, password: 'brand-new-password' })).status).toBe(404);
    const inv = await db.query('SELECT used_at FROM invites WHERE token_hash = ?', [hashToken(token)]);
    expect(inv[0].used_at).toBeNull();
  });
});

describe('ensureAdmin', () => {
  test('ensureAdmin creates an admin from ADMIN_LOGIN/ADMIN_PASSWORD/ADMIN_NAME when no admin exists', async () => {
    const { db } = await setup();
    await ensureAdmin(db, { adminLogin: 'Root', adminPassword: 'twelve-chars-ok', adminName: 'Root User' }, T0);
    const rows = await db.query('SELECT * FROM users');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ login: 'root', name: 'Root User', role: 'admin', time_zone: 'UTC', active: 1 });
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$12\$/);
  });

  test('ensureAdmin does nothing when an admin exists, and throws if no admin exists and ADMIN_PASSWORD is under 12 chars', async () => {
    const { db } = await setup();
    await expect(ensureAdmin(db, { adminLogin: 'root', adminPassword: 'short' }, T0)).rejects.toThrow(/12/);
    await expect(ensureAdmin(db, { adminPassword: 'short' }, T0)).rejects.toThrow(/12/);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(ensureAdmin(db, {}, T0)).resolves.toBeUndefined(); // warns, no throw
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
    await createUser(db, { login: 'existing', role: 'admin' });
    await ensureAdmin(db, { adminLogin: 'root', adminPassword: 'short' }, T0);
    await ensureAdmin(db, { adminLogin: 'root', adminPassword: 'twelve-chars-ok' }, T0);
    const rows = await db.query('SELECT login FROM users');
    expect(rows.map((r: any) => r.login)).toEqual(['existing']);
  });
});
