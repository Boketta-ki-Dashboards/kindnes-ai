import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    pool: 'forks',
    env: {KAI_QUIET: '1', KAI_LOG_DIR: '.cache/test-logs'},
  },
});
