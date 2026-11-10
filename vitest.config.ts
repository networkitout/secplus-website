import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'client/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
  },
});
