import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    // Run rule test files serially — they share a single Firebase Emulator instance and
    // concurrent initializeTestEnvironment calls across files corrupt each other's storage ruleset.
    fileParallelism: false,
    include: ['src/rules/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
