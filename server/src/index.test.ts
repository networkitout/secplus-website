import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ENTRY = path.join(ROOT, 'server/src/index.ts');
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

type Exit = { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string };

/**
 * Starts the real entry point in a child process. The variables given replace the test process's own and a
 * `.env` file's (which never overrides a set variable), so nothing here depends on the developer's `.env`.
 */
const children = new Set<ReturnType<typeof spawn>>();
afterEach(() => {
  // A start that should have stopped on its own but did not must not outlive its test.
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  children.clear();
});

function startServer(env: Record<string, string>, cwd = ROOT) {
  const child = spawn(process.execPath, ['--import', TSX, ENTRY], {
    cwd,
    env: { PATH: process.env.PATH, ADMIN_LOGIN: '', ADMIN_PASSWORD: '', ADMIN_NAME: '', NODE_ENV: 'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  const exited = new Promise<Exit>((resolve) => child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr })));
  return { child, exited };
}

const FIXTURE_CONTENT = path.join(ROOT, 'server/src/test/fixtures/content');
const UNREACHABLE_DB = 'mysql://nobody:nothing@127.0.0.1:1/none';
const testDb = () => process.env.TEST_DATABASE_URL!;

/** A directory to start the server from, holding a copy of the fixture content (and no migrations). */
function workDirWithContent(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secplus-start-'));
  fs.cpSync(FIXTURE_CONTENT, path.join(dir, 'content'), { recursive: true });
  return dir;
}

const listening = (server: net.Server) =>
  new Promise<number>((resolve) => server.listen(0, () => resolve((server.address() as net.AddressInfo).port)));

async function freePort(): Promise<number> {
  const probe = net.createServer();
  const port = await listening(probe);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** Resolves once the child has printed `text` on stdout. */
function printed(child: ReturnType<typeof startServer>['child'], text: string): Promise<void> {
  return new Promise((resolve) => {
    let seen = '';
    child.stdout.on('data', (d) => {
      seen += d;
      if (seen.includes(text)) resolve();
    });
  });
}

describe('server start', () => {
  test('an invalid TRUST_PROXY stops the start with a message naming it, before the database is touched', async () => {
    const { exited } = startServer({ DATABASE_URL: 'mysql://nobody:nothing@127.0.0.1:1/none', TRUST_PROXY: 'two' });
    const exit = await exited;
    expect(exit.code).toBe(1);
    expect(exit.stderr.trim()).toBe(
      'Configuration error: TRUST_PROXY must be a whole number of reverse proxies in front of the app (0 or more), got "two"',
    );
  });

  test('invalid content stops the start with the file and field, before the database is touched', async () => {
    const dir = workDirWithContent();
    const file = path.join(dir, 'content/domains/1/1.1/questions.json');
    const questions = JSON.parse(fs.readFileSync(file, 'utf8'));
    questions[0].explanation = '';
    fs.writeFileSync(file, JSON.stringify(questions));
    const exit = await startServer({ DATABASE_URL: UNREACHABLE_DB }, dir).exited;
    expect(exit.code).toBe(1);
    // The same line `npm run check-content` prints: file, field, message.
    expect(exit.stderr.trim()).toMatch(/^content\/domains\/1\/1\.1\/questions\.json: explanation: 0\.explanation: .+$/);
    expect(exit.stderr).not.toContain('Database');
    expect(exit.stdout).toBe('');
  });

  test('an unreachable database is reported as such', async () => {
    const exit = await startServer({ DATABASE_URL: UNREACHABLE_DB }).exited;
    expect(exit.code).toBe(1);
    expect(exit.stderr.trim()).toMatch(/^Database unavailable at startup: \[ECONNREFUSED\] /);
  });

  test('a missing migrations directory is reported as that, not as an unavailable database', async () => {
    const dir = workDirWithContent(); // valid content, but not the repository root: no server/src/db/migrations
    const exit = await startServer({ DATABASE_URL: testDb() }, dir).exited;
    expect(exit.code).toBe(1);
    expect(exit.stderr).not.toContain('Database unavailable');
    expect(exit.stderr.trim()).toMatch(/^Cannot read the migrations directory .*server\/src\/db\/migrations.* Start the server from the repository root\.$/);
  });

  test('a port that is already in use stops the start with a message and a non-zero exit', async () => {
    const taken = net.createServer();
    const port = await listening(taken);
    try {
      const exit = await startServer({ DATABASE_URL: testDb(), PORT: String(port) }).exited;
      expect(exit.code).toBe(1);
      expect(exit.stderr).toMatch(new RegExp(`Cannot listen on port ${port}: .*EADDRINUSE`));
      expect(exit.stdout).not.toContain('Listening');
    } finally {
      await new Promise((resolve) => taken.close(resolve));
    }
  });

  test.each(['SIGTERM', 'SIGINT'] as const)('%s stops accepting connections, closes the pool and exits cleanly', async (signal) => {
    const port = await freePort();
    const { child, exited } = startServer({ DATABASE_URL: testDb(), PORT: String(port) });
    await printed(child, `Listening on port ${port}`);
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
    child.kill(signal);
    const exit = await exited;
    expect(exit).toMatchObject({ code: 0, signal: null });
    expect(exit.stdout).toContain(`${signal} received: shutting down`);
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
  });
});
