import mongoose from 'mongoose';
import { down, up } from '../../migrations/20260923200000-sessions.js';

describe('sessions migration (e2e)', () => {
  let connection: mongoose.Connection;
  const db = () => connection.db!;

  const userId = new mongoose.Types.ObjectId().toString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 3_600_000);

  beforeAll(async () => {
    connection = await mongoose
      .createConnection(process.env.MONGODB_URI ?? '', {
        dbName: 'sessions-migration-test',
      })
      .asPromise();
  });

  beforeEach(async () => {
    await db().collection('refreshtokens').deleteMany({});
    await db().collection('sessions').deleteMany({});
    // Two devices, one of which already rotated once: three tokens, two families.
    await db()
      .collection('refreshtokens')
      .insertMany([
        {
          tokenHash: 'a',
          userId,
          familyId: 'family-one',
          consumedAt: new Date(),
          expiresAt,
        },
        {
          tokenHash: 'b',
          userId,
          familyId: 'family-one',
          consumedAt: null,
          expiresAt,
        },
        {
          tokenHash: 'c',
          userId,
          familyId: 'family-two',
          consumedAt: null,
          expiresAt,
        },
      ]);
  });

  afterAll(async () => {
    await connection.close();
  });

  it('turns every token family into a session and re-points its tokens, idempotently', async () => {
    await up(db());
    await up(db());

    const sessions = await db().collection('sessions').find({}).toArray();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ userId });
    expect(sessions[0].expiresAt).toEqual(expiresAt);

    const tokens = await db()
      .collection('refreshtokens')
      .find({})
      .sort({ tokenHash: 1 })
      .toArray();
    expect(tokens.every((token) => token.familyId === undefined)).toBe(true);
    // The two tokens of one family share a session, the third gets its own.
    expect(tokens[0].sessionId).toBe(tokens[1].sessionId);
    expect(tokens[2].sessionId).not.toBe(tokens[0].sessionId);
    expect(sessions.map((session) => session._id.toString()).sort()).toEqual(
      [...new Set(tokens.map((token) => token.sessionId))].sort(),
    );

    const indexNames = (await db().collection('sessions').indexes()).map(
      (index) => index.name,
    );
    expect(indexNames).toEqual(
      expect.arrayContaining(['userId_1', 'expiresAt_1']),
    );
  });

  it('down puts the tokens back into families and drops the sessions', async () => {
    await up(db());
    await down(db());

    const tokens = await db().collection('refreshtokens').find({}).toArray();
    expect(tokens.every((token) => token.sessionId === undefined)).toBe(true);
    expect(tokens.every((token) => typeof token.familyId === 'string')).toBe(
      true,
    );
    expect(
      await db().listCollections({ name: 'sessions' }).toArray(),
    ).toHaveLength(0);
  });
});
