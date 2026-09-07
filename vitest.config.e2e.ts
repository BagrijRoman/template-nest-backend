import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup/mongoMemoryServer.ts'],
    // The first run downloads the mongod binary; starting an instance also takes a moment.
    hookTimeout: 120_000,
  },
});
