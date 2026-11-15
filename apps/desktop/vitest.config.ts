import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'desktop',
    // Logic that runs without Electron (shared code, the session manager). UI flows are covered
    // by the Playwright tests in e2e/, which run separately.
    include: ['src/**/*.test.ts'],
  },
});
