import mongoose from 'mongoose';
import { down, up } from '../../migrations/20260923000000-credentials.js';

// Runs the data migration against the same in-memory MongoDB the other e2e tests use.
describe('credentials migration (e2e)', () => {
  let connection: mongoose.Connection;
  const db = () => connection.db!;

  const legacyUser = {
    _id: new mongoose.Types.ObjectId(),
    email: 'legacy@example.com',
    passwordHash: 'salt:hash',
  };

  beforeAll(async () => {
    // A dedicated database: the shared default one is owned by the app under test.
    connection = await mongoose
      .createConnection(process.env.MONGODB_URI ?? '', {
        dbName: 'credentials-migration-test',
      })
      .asPromise();
  });

  beforeEach(async () => {
    await db().collection('users').deleteMany({});
    await db().collection('credentials').deleteMany({});
    await db().collection('users').insertOne(legacyUser);
  });

  afterAll(async () => {
    await connection.close();
  });

  it('moves every password hash into a credential and strips it from the user, idempotently', async () => {
    await up(db());
    // A second run finds nothing left to move and must not throw or duplicate.
    await up(db());

    const user = await db()
      .collection('users')
      .findOne({ _id: legacyUser._id });
    expect(user).not.toHaveProperty('passwordHash');

    const credentials = await db().collection('credentials').find({}).toArray();
    expect(credentials).toHaveLength(1);
    expect(credentials[0]).toMatchObject({
      userId: legacyUser._id.toString(),
      type: 'password',
      secretHash: 'salt:hash',
    });
    expect(credentials[0].createdAt).toBeInstanceOf(Date);

    const indexes = await db().collection('credentials').indexes();
    expect(indexes).toContainEqual(
      expect.objectContaining({ name: 'userId_1_type_1', unique: true }),
    );
  });

  it('down puts the hashes back on the users and removes the credentials', async () => {
    await up(db());
    await down(db());

    const user = await db()
      .collection('users')
      .findOne({ _id: legacyUser._id });
    expect(user?.passwordHash).toBe('salt:hash');
    expect(await db().collection('credentials').countDocuments()).toBe(0);
    const indexNames = (await db().collection('credentials').indexes()).map(
      (index) => index.name,
    );
    expect(indexNames).not.toContain('userId_1_type_1');
  });
});
