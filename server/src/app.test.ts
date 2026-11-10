import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { CSRF_HEADER, CSRF_VALUE } from './http.js';
import { testApp } from './test/helpers.js';

const fixtureDirWithIndexHtml = mkdtempSync(join(tmpdir(), 'secplus-client-'));
writeFileSync(
  join(fixtureDirWithIndexHtml, 'index.html'),
  '<!doctype html><html><body><div id="root"></div></body></html>',
);

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
