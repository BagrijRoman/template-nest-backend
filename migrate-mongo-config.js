// Loads .env for local runs; in CI/production the variables come from the environment itself.
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on variables already present in the environment.
}

const url = process.env.MONGODB_URI;
if (!url) {
  throw new Error('MONGODB_URI must be set to run migrations');
}

const config = {
  mongodb: {
    url,
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  migrationFileExtension: '.js',
  // A migration, once run, is never edited — write a new one instead; hash tracking off.
  useFileHash: false,
  moduleSystem: 'esm',
};

export default config;
