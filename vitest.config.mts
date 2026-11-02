import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      BCRYPT_SALT_ROUNDS: '4',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
    },
  },
});
