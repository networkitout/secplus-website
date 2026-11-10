import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  test: {
    globals: true,
    fileParallelism: false, // server tests share one database
    environment: 'node',
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'client/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
  },
});
