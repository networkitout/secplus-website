import { connect, type Db } from './db.js';
import { migrate } from './migrate.js';
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
    process.env.TEST_DATABASE_URL = saved.test;
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
