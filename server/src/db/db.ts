import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from 'mysql2/promise';

export type Db = {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string, params?: unknown[]): Promise<{ insertId: number; affectedRows: number }>;
  tx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

type Runner = Pick<Pool | PoolConnection, 'query'>;

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

export function connect(url: string): Db {
  const u = new URL(url);
  const pool = mysql.createPool({
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    timezone: 'Z',
    dateStrings: ['DATE'],
    connectionLimit: 10,
  });

  const db: Db = wrap(
    pool,
    async (fn) => {
      const conn = await pool.getConnection();
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
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    },
    () => pool.end(),
  );
  return db;
}
