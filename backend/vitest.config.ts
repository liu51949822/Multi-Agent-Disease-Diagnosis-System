import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: {
      GOOGLE_API_KEY: 'test-key-for-unit-tests',
    },
  },
});
