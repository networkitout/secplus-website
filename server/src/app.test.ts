import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { format } from 'node:util';
import request from 'supertest';
import { CSRF_HEADER, CSRF_VALUE } from './http.js';
import { createUser, loginAs, testApp } from './test/helpers.js';

const fixtureDirWithIndexHtml = mkdtempSync(join(tmpdir(), 'secplus-client-'));
writeFileSync(
  join(fixtureDirWithIndexHtml, 'index.html'),
  '<!doctype html><html><body><div id="root"></div></body></html>',
);
mkdirSync(join(fixtureDirWithIndexHtml, 'assets'));
writeFileSync(join(fixtureDirWithIndexHtml, 'assets', 'index-abc123.js'), 'console.log("app")');
writeFileSync(join(fixtureDirWithIndexHtml, 'robots.txt'), 'User-agent: *');

/** Runs `fn` with console.error captured; returns what was logged, formatted the way the console prints it. */
async function capturingErrors(fn: () => Promise<void>): Promise<string[]> {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await fn();
    return logged.mock.calls.map((args) => format(...args));
  } finally {
    logged.mockRestore();
  }
}

test('health endpoint', async () => {
  const { app } = await testApp();
  const res = await request(app).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
test('unknown api route is JSON 404', async () => {
  const { app } = await testApp();
  const res = await request(app).get('/api/nope');
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'Not found' });
});
test('non-api paths serve the client index.html', async () => {
  const { app } = await testApp({ clientDir: fixtureDirWithIndexHtml });
  const res = await request(app).get('/dashboard');
  expect(res.status).toBe(200);
  expect(res.text).toContain('<div id="root">');
});
test('the app shell is served for deep links when the build lives under a dot-directory', async () => {
  // A path such as /home/user/.apps/site/dist/client: only the file's own name may be judged a dotfile.
  const hidden = join(mkdtempSync(join(tmpdir(), 'secplus-client-')), '.hidden', 'client');
  mkdirSync(hidden, { recursive: true });
  writeFileSync(join(hidden, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>');
  const { app } = await testApp({ clientDir: hidden });
  for (const url of ['/', '/dashboard', '/lesson/1.1']) {
    const res = await request(app).get(url);
    expect(res.status, url).toBe(200);
    expect(res.text, url).toContain('<div id="root">');
  }
});
test('a missing file under /assets/ is a 404, not the app shell', async () => {
  const { app } = await testApp({ clientDir: fixtureDirWithIndexHtml });
  for (const url of ['/assets/index-old123.js', '/assets/missing.css', '/assets/']) {
    const res = await request(app).get(url);
    expect(res.status, url).toBe(404);
    expect(res.text, url).not.toContain('<div id="root">');
  }
});
test('malformed JSON body is a 400 without details', async () => {
  const { app } = await testApp();
  const res = await request(app).post('/api/health').set(CSRF_HEADER, CSRF_VALUE).set('Content-Type', 'application/json').send('{bad');
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'Bad request' });
});

// ---------------------------------------------------------------- headers

test('the content security policy allows only what the built client needs', async () => {
  const { app } = await testApp({ clientDir: fixtureDirWithIndexHtml });
  const expected =
    "default-src 'self';style-src 'self';style-src-attr 'unsafe-inline';img-src 'self' data:;script-src 'self';" +
    "base-uri 'self';form-action 'self';object-src 'none';frame-ancestors 'none'";
  for (const url of ['/api/health', '/', '/dashboard']) {
    expect((await request(app).get(url)).headers['content-security-policy'], url).toBe(expected);
  }
});

test('every /api response is marked no-store, whatever its status', async () => {
  const { app, db } = await testApp();
  const user = await createUser(db);
  const agent = await loginAs(app, user);
  const csrf = (r: request.Test) => r.set(CSRF_HEADER, CSRF_VALUE);
  const responses = {
    health: await request(app).get('/api/health'),
    signedIn: await agent.get('/api/auth/me'),
    login: await csrf(request(app).post('/api/auth/login')).send({ login: user.login, password: user.password }),
    notSignedIn: await request(app).get('/api/auth/me'),
    unknown: await request(app).get('/api/nope'),
    noCsrfHeader: await request(app).post('/api/auth/logout'),
    invalidBody: await csrf(request(app).post('/api/auth/login')).send({ login: 5 }),
    malformedJson: await csrf(request(app).post('/api/health')).set('Content-Type', 'application/json').send('{bad'),
    malformedPath: await request(app).get('/api/auth/invite/%E0%A4%A'),
  };
  expect(Object.entries(responses).map(([name, r]) => [name, r.status])).toEqual([
    ['health', 200],
    ['signedIn', 200],
    ['login', 200],
    ['notSignedIn', 401],
    ['unknown', 404],
    ['noCsrfHeader', 403],
    ['invalidBody', 400],
    ['malformedJson', 400],
    ['malformedPath', 400],
  ]);
  for (const [name, r] of Object.entries(responses)) expect(r.headers['cache-control'], name).toBe('no-store');
});

test('hashed files under /assets are cached for a year as immutable; the app shell is always revalidated', async () => {
  const { app } = await testApp({ clientDir: fixtureDirWithIndexHtml });
  const asset = await request(app).get('/assets/index-abc123.js');
  expect(asset.status).toBe(200);
  expect(asset.text).toBe('console.log("app")');
  expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  for (const url of ['/', '/index.html', '/dashboard', '/lesson/1.1']) {
    const shell = await request(app).get(url);
    expect(shell.status, url).toBe(200);
    expect(shell.text, url).toContain('<div id="root">');
    expect(shell.headers['cache-control'], url).toBe('no-cache');
  }
  // Any other file of the build is not hashed: it is not given the long lifetime.
  const other = await request(app).get('/robots.txt');
  expect(other.status).toBe(200);
  expect(other.headers['cache-control']).toBe('public, max-age=0');
  // A missing hashed file is a 404 and is not cached as immutable either.
  const gone = await request(app).get('/assets/index-old123.js');
  expect(gone.status).toBe(404);
  expect(gone.headers['cache-control'] ?? '').not.toContain('immutable');
});

// ---------------------------------------------------------------- errors

test('a malformed percent-escape in a path is a 400 with a generic body, and is not logged as a server error', async () => {
  const { app, db } = await testApp();
  const agent = await loginAs(app, await createUser(db));
  const logged = await capturingErrors(async () => {
    for (const [client, url] of [
      [request(app), '/api/auth/invite/%E0%A4%A'], // needs no session
      [agent, '/api/lessons/%'],
      [agent, '/api/review/flashcard/%ZZ'],
    ] as const) {
      const res = await client.get(url);
      expect(res.status, url).toBe(400);
      expect(res.body, url).toEqual({ error: 'Bad request' });
    }
  });
  expect(logged).toEqual([]);
});

test('a build without index.html is still a logged server error, not a quiet 404', async () => {
  const { app } = await testApp({ clientDir: mkdtempSync(join(tmpdir(), 'secplus-empty-client-')) });
  const logged = await capturingErrors(async () => {
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Server error' });
  });
  expect(logged).toHaveLength(1);
  expect(logged[0]).toContain('index.html');
});

test('a database error is logged with its code, message and stack, but never with the SQL text', async () => {
  const { app, db } = await testApp();
  // What mysql2 raises: the statement, with its values written in, rides along on the error.
  const failure = Object.assign(new Error("Unknown column 'nope' in 'field list'"), {
    code: 'ER_BAD_FIELD_ERROR',
    errno: 1054,
    sqlState: '42S22',
    sqlMessage: "Unknown column 'nope' in 'field list'",
    sql: "UPDATE users SET password_hash = '$2b$12$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ01234' WHERE id = 7",
  });
  const query = vi.spyOn(db, 'query').mockRejectedValue(failure);
  let logged: string[];
  try {
    logged = await capturingErrors(async () => {
      const res = await request(app).get('/api/auth/invite/some-token');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Server error' });
    });
  } finally {
    query.mockRestore();
  }
  expect(logged).toHaveLength(1);
  expect(logged[0]).toContain('ER_BAD_FIELD_ERROR');
  expect(logged[0]).toContain("Unknown column 'nope' in 'field list'");
  expect(logged[0]).toMatch(/\n\s+at /); // the stack
  expect(logged[0]).not.toContain('$2b$12$');
  expect(logged[0]).not.toContain('UPDATE users');
  expect(logged[0]).not.toContain('password_hash');
});

test('when the database cannot be reached, or gives up on a lock, the API answers 503 so the client retries', async () => {
  const { app, db } = await testApp();
  const agent = await loginAs(app, await createUser(db));
  const answer = { questionId: 'q-1.1-001', answer: { type: 'single', choice: 'b' } };
  const failures: [Error, number][] = [
    [Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), { code: 'ECONNREFUSED', fatal: true }), 503],
    [Object.assign(new Error('Connection lost: The server closed the connection.'), { code: 'PROTOCOL_CONNECTION_LOST', fatal: true }), 503],
    [Object.assign(new Error("Can't add new command when connection is in closed state"), { fatal: true }), 503],
    [new Error('Pool is closed.'), 503],
    [Object.assign(new Error('Lock wait timeout exceeded; try restarting transaction'), { code: 'ER_LOCK_WAIT_TIMEOUT' }), 503],
    [Object.assign(new Error('Deadlock found when trying to get lock; try restarting transaction'), { code: 'ER_LOCK_DEADLOCK' }), 503],
    [new Error('something else'), 500],
  ];
  const tx = db.tx;
  try {
    for (const [failure, status] of failures) {
      db.tx = async () => {
        throw failure;
      };
      const logged = await capturingErrors(async () => {
        const res = await agent.post('/api/answers').send(answer);
        expect(res.status, failure.message).toBe(status);
        expect(res.body, failure.message).toEqual({ error: status === 503 ? 'Service unavailable' : 'Server error' });
      });
      // Either way the operator is told, in one entry.
      expect(logged, failure.message).toHaveLength(1);
      expect(logged[0]).toContain(failure.message);
    }
  } finally {
    db.tx = tx;
  }
  expect((await agent.post('/api/answers').send(answer)).status).toBe(200);
});
