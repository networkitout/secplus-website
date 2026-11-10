import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connect, type Db } from './db.js';
import { migrate, MigrationFilesError } from './migrate.js';
import { createUser, testApp } from '../test/helpers.js';

async function dropAllTables(db: Db) {
  const tables = await db.query<{ name: string }>(
    'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()',
  );
  await db.exec('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) await db.exec(`DROP TABLE \`${t.name}\``);
  await db.exec('SET FOREIGN_KEY_CHECKS = 1');
}

test('migrate applies once and is idempotent', async () => {
  const db = connect(process.env.TEST_DATABASE_URL!);
  try {
    // pool connections are independent, so run the session-scoped FK toggle through a tx on one connection
    await db.tx((tx) => dropAllTables(tx));
    expect(await migrate(db)).toEqual(['001_init.sql']);
    expect(await migrate(db)).toEqual([]);
    const t = await db.query<{ n: number }>(
      'SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE()',
    );
    expect(Number(t[0].n)).toBe(11); // 10 tables + schema_migrations
  } finally {
    await db.close();
  }
});

test('a migrations directory that cannot be read is reported by name, before the database is used', async () => {
  const untouched = new Proxy({} as Db, {
    get() {
      throw new Error('the database must not be used');
    },
  });
  const dir = path.join(tmpdir(), 'secplus-no-such-migrations');
  const failure = await migrate(untouched, dir).catch((err) => err);
  expect(failure).toBeInstanceOf(MigrationFilesError);
  expect(failure.message).toContain(`Cannot read the migrations directory ${dir}`);
});

test('a migration whose statement fails is reported with its file name and is not recorded', async () => {
  const { db } = await testApp();
  const dir = mkdtempSync(path.join(tmpdir(), 'secplus-migrations-'));
  writeFileSync(path.join(dir, '900_broken.sql'), 'INSERT INTO no_such_table_anywhere (id) VALUES (1);\n');
  await expect(migrate(db, dir)).rejects.toThrow(/^Migration 900_broken\.sql failed: \[ER_NO_SUCH_TABLE\] /);
  expect(await db.query("SELECT 1 FROM schema_migrations WHERE name = '900_broken.sql'")).toHaveLength(0);
});

test('tx rolls back on throw', async () => {
  const { db } = await testApp();
  await expect(
    db.tx(async (tx) => {
      await createUser(tx);
      throw new Error('x');
    }),
  ).rejects.toThrow('x');
  expect(await db.query('SELECT id FROM users')).toHaveLength(0);
});

test('tx commits on success', async () => {
  const { db } = await testApp();
  await db.tx(async (tx) => {
    await createUser(tx, { login: 'committed' });
  });
  expect(await db.query('SELECT login FROM users')).toEqual([{ login: 'committed' }]);
});

describe('testApp guards', () => {
  const saved = { test: process.env.TEST_DATABASE_URL, main: process.env.DATABASE_URL };
  afterEach(() => {
    if (saved.test === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = saved.test;
    if (saved.main === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved.main;
  });

  test('testApp fails loudly without TEST_DATABASE_URL', async () => {
    delete process.env.TEST_DATABASE_URL;
    await expect(testApp()).rejects.toThrow('TEST_DATABASE_URL');
  });

  test('testApp refuses to run against DATABASE_URL', async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    await expect(testApp()).rejects.toThrow('TEST_DATABASE_URL');
  });
});
