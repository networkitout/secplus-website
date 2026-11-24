import { createUser, testApp } from '../test/helpers.js';
import { isDbUnavailable, poolOptions } from './db.js';

const deadlock = () =>
  Object.assign(new Error('Deadlock found when trying to get lock; try restarting transaction'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 });

describe('tx retry on deadlock', () => {
  test('a transaction that loses a deadlock is rolled back and run once more', async () => {
    const { db } = await testApp();
    let runs = 0;
    const result = await db.tx(async (tx) => {
      runs++;
      await createUser(tx, { login: `run${runs}` });
      if (runs === 1) throw deadlock();
      return 'done';
    });
    expect(result).toBe('done');
    expect(runs).toBe(2);
    // What the first run wrote is gone; the second run's work is committed.
    expect(await db.query('SELECT login FROM users')).toEqual([{ login: 'run2' }]);
  });

  test('a second deadlock is not retried again: the error is passed on and nothing is committed', async () => {
    const { db } = await testApp();
    let runs = 0;
    await expect(
      db.tx(async (tx) => {
        runs++;
        await createUser(tx);
        throw deadlock();
      }),
    ).rejects.toMatchObject({ code: 'ER_LOCK_DEADLOCK' });
    expect(runs).toBe(2);
    expect(await db.query('SELECT 1 FROM users')).toHaveLength(0);
  });

  test('any other error is not retried', async () => {
    const { db } = await testApp();
    let runs = 0;
    await expect(
      db.tx(async () => {
        runs++;
        throw Object.assign(new Error('Lock wait timeout exceeded'), { code: 'ER_LOCK_WAIT_TIMEOUT' });
      }),
    ).rejects.toMatchObject({ code: 'ER_LOCK_WAIT_TIMEOUT' });
    expect(runs).toBe(1);
  });

  test('only the outermost transaction is retried: a nested one passes the deadlock up and the whole is run again', async () => {
    const { db } = await testApp();
    const runs = { outer: 0, inner: 0 };
    await db.tx(async (tx) => {
      runs.outer++;
      await createUser(tx, { login: `outer${runs.outer}` });
      await tx.tx(async (nested) => {
        runs.inner++;
        await createUser(nested, { login: `inner${runs.inner}` });
        if (runs.inner === 1) throw deadlock();
      });
    });
    expect(runs).toEqual({ outer: 2, inner: 2 });
    expect((await db.query<{ login: string }>('SELECT login FROM users ORDER BY login')).map((u) => u.login)).toEqual(['inner2', 'outer2']);
  });

  test('two transactions that really deadlock in MySQL both complete', async () => {
    const { db } = await testApp();
    const a = await createUser(db, { login: 'a' });
    const b = await createUser(db, { login: 'b' });
    const lock = (tx: typeof db, id: number) => tx.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [id]);
    const rename = (tx: typeof db, id: number, name: string) => tx.exec('UPDATE users SET name = ? WHERE id = ?', [name, id]);
    const gate = () => {
      let open!: () => void;
      const opened = new Promise<void>((resolve) => (open = resolve));
      return { open, opened };
    };
    const firstLocked = gate();
    const secondLocked = gate();
    let runs = 0;
    // Each holds one row and then asks for the other's: MySQL rolls one of them back.
    const first = db.tx(async (tx) => {
      runs++;
      await lock(tx, a.id);
      firstLocked.open();
      await secondLocked.opened;
      await rename(tx, b.id, 'renamed by first');
    });
    const second = db.tx(async (tx) => {
      runs++;
      await lock(tx, b.id);
      secondLocked.open();
      await firstLocked.opened;
      await rename(tx, a.id, 'renamed by second');
    });
    await expect(Promise.all([first, second])).resolves.toBeDefined();
    expect(runs).toBe(3); // the victim ran twice
    const names = await db.query<{ login: string; name: string }>('SELECT login, name FROM users ORDER BY login');
    expect(names).toEqual([
      { login: 'a', name: 'renamed by second' },
      { login: 'b', name: 'renamed by first' },
    ]);
  });
});

describe('tx failure handling', () => {
  test('when the rollback itself fails, the error that caused it is the one reported', async () => {
    const { db } = await testApp();
    await expect(
      db.tx(async (tx) => {
        await createUser(tx, { login: 'never' });
        // The connection dies under the transaction, so its rollback cannot be sent.
        const [{ id }] = await tx.query<{ id: number }>('SELECT CONNECTION_ID() AS id');
        await db.exec('KILL ?', [id]);
        throw new Error('the original failure');
      }),
    ).rejects.toThrow('the original failure');
    // The dead connection is not handed out again, and the server rolled its work back.
    expect(await db.query('SELECT 1 FROM users')).toHaveLength(0);
    await db.tx(async (tx) => {
      await createUser(tx, { login: 'after' });
    });
    expect(await db.query('SELECT login FROM users')).toEqual([{ login: 'after' }]);
  });
});

describe('isDbUnavailable', () => {
  test('connection-level failures and lock give-ups are "unavailable"; query errors are not', () => {
    const coded = (code: string, extra: object = {}) => Object.assign(new Error(code), { code, ...extra });
    for (const err of [
      coded('ECONNREFUSED', { fatal: true }),
      coded('PROTOCOL_CONNECTION_LOST', { fatal: true }),
      coded('ETIMEDOUT'),
      coded('EHOSTUNREACH'),
      coded('ER_CON_COUNT_ERROR'),
      coded('ER_LOCK_DEADLOCK'),
      coded('ER_LOCK_WAIT_TIMEOUT'),
      Object.assign(new Error("Can't add new command when connection is in closed state"), { fatal: true }),
      new Error('Pool is closed.'),
    ]) {
      expect(isDbUnavailable(err), err.message).toBe(true);
    }
    for (const err of [coded('ER_DUP_ENTRY'), coded('ER_BAD_FIELD_ERROR'), coded('ER_PARSE_ERROR'), new Error('x'), null, undefined, 'x']) {
      expect(isDbUnavailable(err), String(err)).toBe(false);
    }
  });
});

describe('poolOptions', () => {
  test('reads the URL and keeps idle connections alive', () => {
    expect(poolOptions('mysql://us%40er:p%2Fw@db.example.com:3307/sec%2Dplus')).toMatchObject({
      host: 'db.example.com',
      port: 3307,
      user: 'us@er',
      password: 'p/w',
      database: 'sec-plus',
      timezone: 'Z',
      enableKeepAlive: true,
      keepAliveInitialDelay: 30_000,
    });
    expect(poolOptions('mysql://u:p@localhost/db').port).toBe(3306);
  });
});
