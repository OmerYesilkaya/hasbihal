import { defineConfig } from '@playwright/test';

// End-to-end tests of the built desktop app against a real server and database
// (ARCHITECTURE §11). Run with `pnpm --filter @hasbihal/desktop test:e2e`; needs Docker.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  globalSetup: './global-setup.ts',
  // Each test sets up its own people and rooms, so any one runs alone (`pnpm test:e2e hangout`)
  // or in any order. One at a time: they share one server, and calls and screen sharing are
  // timing-sensitive enough not to want a busy machine.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  outputDir: '../test-results',
});
