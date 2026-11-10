import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../app.js';
import { CSRF_HEADER, CSRF_VALUE } from '../http.js';
import { loadContent, type Content } from '../content/loader.js';
import { connect, type Db } from '../db/db.js';
import { migrate } from '../db/migrate.js';

type TestAgent = ReturnType<typeof request.agent>;

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/content');

let shared: { url: string; db: Db } | undefined;

export function fixtureContent(): Content {
  return loadContent(FIXTURE_DIR);
}

export async function testApp(
  opts: { now?: () => Date; clientDir?: string } = {},
): Promise<{ app: Express; db: Db; content: Content; setNow(d: Date): void }> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set; tests need a dedicated MySQL database');
  if (url === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL: tests truncate every table');
  }
  if (!shared || shared.url !== url) {
    if (shared) await shared.db.close();
    shared = { url, db: connect(url) };
  }
  const { db } = shared;
  await migrate(db);
  const tables = await db.query<{ name: string }>(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'",
  );
  await db.exec('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const t of tables) await db.exec(`TRUNCATE TABLE \`${t.name}\``);
  } finally {
    await db.exec('SET FOREIGN_KEY_CHECKS = 1');
  }

  let current = opts.now ? opts.now() : new Date();
  const content = fixtureContent();
  const app = createApp({
    db,
    content,
    now: () => current,
    clientDir: opts.clientDir,
    secureCookies: false,
    bcryptCost: 4,
  });
  return {
    app,
    db,
    content,
    setNow(d: Date) {
      current = d;
    },
  };
}

export async function createUser(
  db: Db,
  o: Partial<{
    login: string;
    name: string;
    password: string;
    role: 'learner' | 'admin';
    timeZone: string;
    active: boolean;
  }> = {},
): Promise<{ id: number; login: string; password: string }> {
  const login = o.login ?? `user${Math.random().toString(36).slice(2, 10)}`;
  const password = o.password ?? 'correct-horse-battery';
  const hash = await bcrypt.hash(password, 4); // low cost keeps tests fast; real cost 12 lives in the auth service
  const res = await db.exec(
    'INSERT INTO users (login, name, password_hash, role, time_zone, active) VALUES (?, ?, ?, ?, ?, ?)',
    [login, o.name ?? login, hash, o.role ?? 'learner', o.timeZone ?? 'UTC', o.active === false ? 0 : 1],
  );
  return { id: res.insertId, login, password };
}

export async function loginAs(app: Express, user: { login: string; password: string }): Promise<TestAgent> {
  const agent = request.agent(app).set(CSRF_HEADER, CSRF_VALUE);
  const res = await agent.post('/api/auth/login').send({ login: user.login, password: user.password });
  if (res.status !== 200) throw new Error(`loginAs failed for ${user.login}: ${res.status} ${res.text}`);
  return agent;
}
