import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
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
test('malformed JSON body is a 400 without details', async () => {
  const { app } = await testApp();
  const res = await request(app).post('/api/health').set('Content-Type', 'application/json').send('{bad');
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'Bad request' });
});
