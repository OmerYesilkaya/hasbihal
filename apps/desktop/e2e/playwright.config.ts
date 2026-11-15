import { defineConfig } from '@playwright/test';

// End-to-end tests of the built desktop app against a real server and database
// (ARCHITECTURE §11). Run with `pnpm --filter @hasbihal/desktop test:e2e`; needs Docker.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  globalSetup: './global-setup.ts',
  // One app and one server at a time: the flows share the server's database.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  outputDir: '../test-results',
});
