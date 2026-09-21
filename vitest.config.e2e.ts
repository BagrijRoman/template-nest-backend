import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup/mongoMemoryServer.ts'],
    // The first run downloads the mongod binary; starting an instance also takes a moment.
    hookTimeout: 120_000,
    // All spec files run in parallel, each with its own Nest app, in-memory MongoDB and real
    // scrypt hashing — under that load a single test can exceed vitest's 5s default.
    testTimeout: 30_000,
  },
});
