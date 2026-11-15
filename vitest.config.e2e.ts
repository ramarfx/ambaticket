import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Test berbagi satu database, jadi file harus jalan berurutan.
    fileParallelism: false,
    setupFiles: ['./test/setup-env.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
