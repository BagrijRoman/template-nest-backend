import mongoose from 'mongoose';
import { down, up } from '../../migrations/20260923300000-action-tokens.js';

describe('action-tokens migration (e2e)', () => {
  let connection: mongoose.Connection;
  const db = () => connection.db!;

  const userId = new mongoose.Types.ObjectId().toString();
  const expiresAt = new Date(Date.now() + 30 * 60_000);

  beforeAll(async () => {
    connection = await mongoose
      .createConnection(process.env.MONGODB_URI ?? '', {
        dbName: 'action-tokens-migration-test',
      })
      .asPromise();
  });

  beforeEach(async () => {
    for (const collection of [
      'passwordresettokens',
      'emailverificationtokens',
      'actiontokens',
    ]) {
      await db().collection(collection).deleteMany({});
    }
    await db()
      .collection('passwordresettokens')
      .insertOne({ tokenHash: 'reset-hash', userId, expiresAt });
    await db()
      .collection('emailverificationtokens')
      .insertOne({ tokenHash: 'verification-hash', userId, expiresAt });
  });

  afterAll(async () => {
    await connection.close();
  });

  it('copies both collections into one, tagging each row with its action, idempotently', async () => {
    await up(db());
    await up(db());

    const tokens = await db()
      .collection('actiontokens')
      .find({})
      .sort({ type: 1 })
      .toArray();
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({
      tokenHash: 'verification-hash',
      type: 'email-verification',
      userId,
      expiresAt,
    });
    expect(tokens[1]).toMatchObject({
      tokenHash: 'reset-hash',
      type: 'password-reset',
      userId,
      expiresAt,
    });

    const indexNames = (await db().collection('actiontokens').indexes()).map(
      (index) => index.name,
    );
    expect(indexNames).toEqual(
      expect.arrayContaining(['tokenHash_1', 'userId_1_type_1', 'expiresAt_1']),
    );

    const remaining = await db().listCollections().toArray();
    expect(remaining.map((collection) => collection.name)).not.toContain(
      'passwordresettokens',
    );
  });

  it('down splits the rows back into their own collections', async () => {
    await up(db());
    await down(db());

    const resets = await db()
      .collection('passwordresettokens')
      .find({})
      .toArray();
    const verifications = await db()
      .collection('emailverificationtokens')
      .find({})
      .toArray();
    expect(resets).toHaveLength(1);
    expect(resets[0]).toMatchObject({ tokenHash: 'reset-hash', userId });
    expect(resets[0].type).toBeUndefined();
    expect(verifications[0]).toMatchObject({
      tokenHash: 'verification-hash',
      userId,
    });
    expect(
      await db().listCollections({ name: 'actiontokens' }).toArray(),
    ).toHaveLength(0);
  });
});
