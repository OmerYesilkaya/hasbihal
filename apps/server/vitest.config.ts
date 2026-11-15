import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    // Starts one PostgreSQL container for the whole run (needs Docker).
    globalSetup: ['./test/global-setup.ts'],
    hookTimeout: 30_000,
  },
});
