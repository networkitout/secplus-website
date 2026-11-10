import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  test: {
    globals: true,
    exclude: ['node_modules', 'dist'],
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          fileParallelism: false, // server tests share one database
          include: ['server/**/*.test.ts', 'shared/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['client/**/*.test.{ts,tsx}'],
          setupFiles: ['client/src/test/setup.ts'],
        },
      },
    ],
  },
});
