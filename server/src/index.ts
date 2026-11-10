import path from 'node:path';
import { createApp } from './app.js';
import { loadContent } from './content/loader.js';
import { connect } from './db/db.js';
import { migrate } from './db/migrate.js';
import { loadDotEnv, readEnv } from './env.js';

loadDotEnv();
const env = readEnv();
const db = connect(env.databaseUrl);

try {
  const applied = await migrate(db);
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
} catch (err) {
  console.error('Database unavailable at startup:', err instanceof Error ? err.message : err);
  process.exit(1);
}

const content = loadContent('content');
const app = createApp({
  db,
  content,
  now: () => new Date(),
  clientDir: path.resolve(process.cwd(), 'dist/client'),
  secureCookies: env.nodeEnv === 'production',
});

app.listen(env.port, () => {
  console.log(`Listening on port ${env.port}`);
});
