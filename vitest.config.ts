/**
 * Vitest configuration — two projects: `unit` (frontend and demo backend in a simulated browser)
 * and `db` (the SQL on a real PostgreSQL, see tests/db/globalSetup.ts).
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Frontend and demo backend: fast, no network, runs in a simulated browser.
        test: {
          name: 'unit',
          environment: 'happy-dom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['src/test/setup.ts'],
          testTimeout: 20_000,
        },
      },
      {
        // Real PostgreSQL 17 with the real migrations (see tests/db/globalSetup.ts).
        test: {
          name: 'db',
          environment: 'node',
          include: ['tests/db/**/*.test.ts'],
          globalSetup: ['tests/db/globalSetup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
