import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from './app.js';

const fixtureDirWithIndexHtml = mkdtempSync(join(tmpdir(), 'secplus-client-'));
writeFileSync(
  join(fixtureDirWithIndexHtml, 'index.html'),
  '<!doctype html><html><body><div id="root"></div></body></html>',
);

test('health endpoint', async () => {
  const res = await request(createApp({})).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
test('unknown api route is JSON 404', async () => {
  const res = await request(createApp({})).get('/api/nope');
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'Not found' });
});
test('non-api paths serve the client index.html', async () => {
  const res = await request(createApp({ clientDir: fixtureDirWithIndexHtml })).get('/dashboard');
  expect(res.status).toBe(200);
  expect(res.text).toContain('<div id="root">');
});
