import { readFileSync } from 'node:fs';
import path from 'node:path';

// The host builds with `npm run build` after an install that may leave `devDependencies` out: npm does so
// whenever NODE_ENV is "production", which is one of the variables the deployment sets.
const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string>; dependencies: Record<string, string> };

test('everything `npm run build` needs is installed without devDependencies', () => {
  expect(pkg.scripts.build).toBe('vite build && tsc -p tsconfig.server.json');
  const needed = new Set(['vite', 'typescript']); // the two commands of the build
  // What the Vite configuration loads.
  for (const [, name] of read('vite.config.ts').matchAll(/from '([^'.][^']*)'/g)) needed.add(name!);
  // The type packages of the server compile: the ones its configuration names, and Express, which has none of its own.
  const { types } = (JSON.parse(read('tsconfig.server.json')) as { compilerOptions: { types: string[] } }).compilerOptions;
  for (const name of types) needed.add(`@types/${name}`);
  needed.add('@types/express');

  expect([...needed].filter((name) => !(name in pkg.dependencies))).toEqual([]);
});
