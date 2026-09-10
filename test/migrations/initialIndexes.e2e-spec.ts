import mongoose from 'mongoose';
import { down, up } from '../../migrations/20260910000000-initial-indexes.js';

// Runs the migration against the same in-memory MongoDB the other e2e tests use — proving the
// production index path works, not just autoIndex.
describe('initial-indexes migration (e2e)', () => {
  let connection: mongoose.Connection;
  const db = () => connection.db!;

  beforeAll(async () => {
    // A dedicated database: the shared default one already has autoIndex-created indexes.
    connection = await mongoose
      .createConnection(process.env.MONGODB_URI ?? '', {
        dbName: 'migration-test',
      })
      .asPromise();
  });

  afterAll(async () => {
    await connection.close();
  });

  const indexNames = async (collection: string): Promise<string[]> =>
    (await db().collection(collection).indexes()).map(
      (index) => index.name ?? '',
    );

  it('creates every index the schemas declare, idempotently', async () => {
    await up(db());
    // Running twice must not throw: the spec/options match, so createIndex is a no-op.
    await up(db());

    expect(await indexNames('users')).toContain('email_1');
    expect(await indexNames('refreshtokens')).toEqual(
      expect.arrayContaining(['tokenHash_1', 'familyId_1', 'expiresAt_1']),
    );
    expect(await indexNames('signinattempts')).toEqual(
      expect.arrayContaining(['email_1', 'expiresAt_1']),
    );
    expect(await indexNames('passwordresettokens')).toEqual(
      expect.arrayContaining(['tokenHash_1', 'userId_1', 'expiresAt_1']),
    );
    expect(await indexNames('emailverificationtokens')).toEqual(
      expect.arrayContaining(['tokenHash_1', 'userId_1', 'expiresAt_1']),
    );
    expect(await indexNames('accountactioncounters')).toEqual(
      expect.arrayContaining(['key_1', 'expiresAt_1']),
    );

    const userIndexes = await db().collection('users').indexes();
    expect(userIndexes).toContainEqual(
      expect.objectContaining({ name: 'email_1', unique: true }),
    );
    const ttlIndexes = await db().collection('refreshtokens').indexes();
    expect(ttlIndexes).toContainEqual(
      expect.objectContaining({ name: 'expiresAt_1', expireAfterSeconds: 0 }),
    );
  });

  it('down removes exactly what up created', async () => {
    await up(db());
    await down(db());

    // Only the implicit _id index survives.
    for (const collection of [
      'users',
      'refreshtokens',
      'accountactioncounters',
    ]) {
      expect(await indexNames(collection)).toEqual(['_id_']);
    }
  });
});
