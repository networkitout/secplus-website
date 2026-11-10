import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from './db.js';

export const DEFAULT_MIGRATIONS_DIR = path.resolve(process.cwd(), 'server/src/db/migrations');

export async function migrate(db: Db, dir: string = DEFAULT_MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name VARCHAR(100) NOT NULL PRIMARY KEY,
       applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const statements = readFileSync(path.join(dir, file), 'utf8')
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.trim())
      .filter(Boolean);
    // MySQL DDL auto-commits, so a migration cannot be made atomic; record it once every statement has run.
    for (const statement of statements) await db.exec(statement);
    await db.exec('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
    applied.push(file);
  }
  return applied;
}
