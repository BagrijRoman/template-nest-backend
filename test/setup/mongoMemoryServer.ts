import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll } from 'vitest';

// Each e2e test file gets its own isolated in-memory MongoDB instance: no local
// database, no state shared between files, nothing left behind after the run.
// Started at module load (not in beforeAll): ConfigModule reads env when AppModule
// is imported, so the URI must be in process.env before the test file loads.
const mongoServer = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongoServer.getUri();

afterAll(async () => {
  await mongoServer.stop();
});
