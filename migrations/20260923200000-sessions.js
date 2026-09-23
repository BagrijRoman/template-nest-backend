// Turns refresh-token families into device sessions: one `sessions` document per familyId, with the
// tokens re-pointed at it. Idempotent: tokens already carrying a sessionId are left alone.
const SESSION_INDEXES = [
  [{ userId: 1 }, { name: 'userId_1' }],
  [{ expiresAt: 1 }, { name: 'expiresAt_1', expireAfterSeconds: 0 }],
];

export const up = async (db) => {
  for (const [keys, options] of SESSION_INDEXES) {
    await db.collection('sessions').createIndex(keys, options);
  }
  await db.collection('refreshtokens').createIndex({ sessionId: 1 }, { name: 'sessionId_1' });

  const families = await db
    .collection('refreshtokens')
    .aggregate([
      { $match: { familyId: { $exists: true } } },
      { $group: { _id: { familyId: '$familyId', userId: '$userId' }, expiresAt: { $max: '$expiresAt' } } },
    ])
    .toArray();

  for (const family of families) {
    const now = new Date();
    const { insertedId } = await db.collection('sessions').insertOne({
      userId: family._id.userId,
      // Pre-session tokens carry no device information; the timestamps are all that can be recovered.
      lastSeenAt: now,
      expiresAt: family.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .collection('refreshtokens')
      .updateMany(
        { familyId: family._id.familyId },
        { $set: { sessionId: insertedId.toString() }, $unset: { familyId: '' } },
      );
  }

  await db
    .collection('refreshtokens')
    .dropIndex('familyId_1')
    .catch(() => undefined);
};

export const down = async (db) => {
  await db.collection('refreshtokens').createIndex({ familyId: 1 }, { name: 'familyId_1' });

  const sessions = await db.collection('sessions').find({}).toArray();
  for (const session of sessions) {
    await db
      .collection('refreshtokens')
      .updateMany(
        { sessionId: session._id.toString() },
        { $set: { familyId: session._id.toString() }, $unset: { sessionId: '' } },
      );
  }

  await db
    .collection('refreshtokens')
    .dropIndex('sessionId_1')
    .catch(() => undefined);
  await db
    .collection('sessions')
    .drop()
    .catch(() => undefined);
};
