// Merges the two identical single-use token collections into `actiontokens`, where each row names
// the action it authorizes. Idempotent: the source collections are emptied as they are copied.
const SOURCES = [
  ['passwordresettokens', 'password-reset'],
  ['emailverificationtokens', 'email-verification'],
];

const INDEXES = [
  [{ tokenHash: 1 }, { name: 'tokenHash_1', unique: true }],
  [{ userId: 1, type: 1 }, { name: 'userId_1_type_1' }],
  [{ expiresAt: 1 }, { name: 'expiresAt_1', expireAfterSeconds: 0 }],
];

export const up = async (db) => {
  for (const [keys, options] of INDEXES) {
    await db.collection('actiontokens').createIndex(keys, options);
  }

  for (const [collection, type] of SOURCES) {
    const tokens = await db.collection(collection).find({}).toArray();
    for (const { _id, tokenHash, userId, expiresAt } of tokens) {
      // A token already copied keeps its hash, so the unique index makes a repeat run a no-op.
      await db
        .collection('actiontokens')
        .updateOne({ tokenHash }, { $setOnInsert: { tokenHash, type, userId, expiresAt } }, { upsert: true });
      await db.collection(collection).deleteOne({ _id });
    }
    await db
      .collection(collection)
      .drop()
      .catch(() => undefined);
  }
};

export const down = async (db) => {
  for (const [collection, type] of SOURCES) {
    const tokens = await db.collection('actiontokens').find({ type }).toArray();
    for (const { tokenHash, userId, expiresAt } of tokens) {
      await db.collection(collection).insertOne({ tokenHash, userId, expiresAt });
    }
    await db.collection(collection).createIndex({ tokenHash: 1 }, { name: 'tokenHash_1', unique: true });
    await db.collection(collection).createIndex({ userId: 1 }, { name: 'userId_1' });
    await db.collection(collection).createIndex({ expiresAt: 1 }, { name: 'expiresAt_1', expireAfterSeconds: 0 });
  }

  await db
    .collection('actiontokens')
    .drop()
    .catch(() => undefined);
};
