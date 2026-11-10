import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
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
function startServer(env: Record<string, string>, cwd = ROOT) {
  const child = spawn(process.execPath, ['--import', TSX, ENTRY], {
    cwd,
    env: { PATH: process.env.PATH, ADMIN_LOGIN: '', ADMIN_PASSWORD: '', ADMIN_NAME: '', NODE_ENV: 'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  const exited = new Promise<Exit>((resolve) => child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr })));
  return { child, exited };
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
});
