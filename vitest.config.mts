import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': import.meta.dirname,
      // `server-only` throws unless it is loaded from a server component, which
      // would block Vitest from importing server modules at all. The guard
      // exists to protect the browser bundle, not the test runner.
      'server-only': path.join(import.meta.dirname, 'tests/stubs/server-only.ts'),
    },
  },
});
