import mysql, { type Pool, type PoolConnection, type PoolOptions, type ResultSetHeader } from 'mysql2/promise';

export type Db = {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string, params?: unknown[]): Promise<{ insertId: number; affectedRows: number }>;
  /**
   * Runs `fn` in a transaction. The outermost transaction is run once more when MySQL picks it as a deadlock
   * victim, so `fn` must be safe to run twice: everything it writes goes through the handle it is given
   * (and is rolled back), and it changes nothing outside itself. A transaction inside one joins it.
   */
  tx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

type Runner = Pick<Pool | PoolConnection, 'query'>;

/** Failures of the connection or the server, and lock waits MySQL gave up on: trying again later can work. */
const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_SERVER_SHUTDOWN',
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
]);
const POOL_CLOSED = 'Pool is closed.'; // mysql2 gives this error no code

/** True when the database could not be reached or could not serve the request just now (the API answers 503). */
export function isDbUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as Error & { code?: unknown; fatal?: unknown };
  return e.fatal === true || UNAVAILABLE_CODES.has(e.code as string) || e.message === POOL_CLOSED;
}

function wrap(runner: Runner, tx: Db['tx'], close: Db['close']): Db {
  return {
    async query(sql, params = []) {
      const [rows] = await runner.query(sql, params);
      return rows as any[];
    },
    async exec(sql, params = []) {
      const [res] = await runner.query(sql, params);
      const header = res as ResultSetHeader;
      return { insertId: header.insertId, affectedRows: header.affectedRows };
    },
    tx,
    close,
  };
}

export function poolOptions(url: string): PoolOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    timezone: 'Z',
    dateStrings: ['DATE'],
    connectionLimit: 10,
    // TCP keep-alive, probing from 30 seconds idle, so a host's idle timeout does not cut pooled connections.
    enableKeepAlive: true,
    keepAliveInitialDelay: 30_000,
  };
}

export function connect(url: string): Db {
  const pool = mysql.createPool(poolOptions(url));

  async function runOnce<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const conn = await pool.getConnection();
    let usable = true;
    try {
      await conn.beginTransaction();
      const inner: Db = wrap(
        conn,
        (nested) => nested(inner), // already inside a transaction
        async () => {},
      );
      const result = await fn(inner);
      await conn.commit();
      return result;
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        // The failure that led here is the one to report. A connection that could not roll back may still
        // hold the transaction open, so it must not go back into the pool.
        usable = false;
      }
      throw err;
    } finally {
      if (usable) conn.release();
      else conn.destroy();
    }
  }

  const db: Db = wrap(
    pool,
    async (fn) => {
      try {
        return await runOnce(fn);
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code !== 'ER_LOCK_DEADLOCK') throw err;
        return runOnce(fn); // MySQL rolled the victim back; once more, and a second deadlock is passed on
      }
    },
    () => pool.end(),
  );
  return db;
}
