import path from 'node:path';
import { createApp } from './app.js';
import { describeContentError, loadContent, type Content } from './content/loader.js';
import { connect, isDbUnavailable } from './db/db.js';
import { migrate, MigrationFilesError } from './db/migrate.js';
import { ensureAdmin } from './features/auth/repo.js';
import { loadDotEnv, readEnv, type Env } from './env.js';
import { errorLine } from './log.js';

// Everything here is relative to the working directory, which must be the repository root: `.env`,
// `content/`, the migrations in `server/src/db/migrations/` and the built client in `dist/client/`.

/** Prints why the server cannot start and stops it. */
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

loadDotEnv();

let env: Env;
try {
  env = readEnv();
} catch (err) {
  fail(`Configuration error: ${errorLine(err)}`);
}

// Content first: it needs no database, and a mistake in it must be named before anything else can fail.
let content: Content;
try {
  content = loadContent('content');
} catch (err) {
  fail(describeContentError(err));
}

const db = connect(env.databaseUrl);

try {
  const applied = await migrate(db);
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
} catch (err) {
  if (err instanceof MigrationFilesError) fail(`${err.message}. Start the server from the repository root.`);
  if (isDbUnavailable(err)) fail(`Database unavailable at startup: ${errorLine(err)}`);
  fail(`Database migration failed: ${errorLine(err)}`);
}

try {
  await ensureAdmin(db, env, new Date());
} catch (err) {
  fail(`Admin bootstrap failed: ${errorLine(err)}`);
}

const app = createApp({
  db,
  content,
  now: () => new Date(),
  clientDir: path.resolve(process.cwd(), 'dist/client'),
  secureCookies: env.secureCookies,
  trustProxy: env.trustProxy,
});

// Express hands a failed listen (a port already in use, say) to this callback instead of throwing.
const server = app.listen(env.port, (err?: Error) => {
  if (err) fail(`Cannot listen on port ${env.port}: ${errorLine(err)}`);
  console.log(`Listening on port ${env.port}`);
});

const SHUTDOWN_GRACE_MS = 10_000;
let stopping = false;

/** Stops accepting connections, lets requests in flight finish, closes the database pool and exits. */
function shutdown(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received: shutting down`);
  // A request that never ends must not keep the process alive for ever.
  setTimeout(() => fail(`Shutdown did not finish within ${SHUTDOWN_GRACE_MS / 1000} seconds; exiting`), SHUTDOWN_GRACE_MS).unref();
  server.close(() => {
    db.close()
      .catch((err) => console.error(`Closing the database pool failed: ${errorLine(err)}`))
      .finally(() => process.exit(0));
  });
  server.closeIdleConnections();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
