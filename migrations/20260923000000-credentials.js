import { Types } from 'mongoose';

// Moves password hashes out of `users` into the `credentials` collection (one document per user
// and credential type, see src/users/entities/credential.entity.ts) and creates its unique index.
// Idempotent: users already migrated have no `passwordHash` left to move.
const PASSWORD_TYPE = 'password';
const INDEX = [
  { userId: 1, type: 1 },
  { name: 'userId_1_type_1', unique: true },
];

export const up = async (db) => {
  await db.collection('credentials').createIndex(...INDEX);

  const users = db.collection('users').find({ passwordHash: { $exists: true } }, { projection: { passwordHash: 1 } });
  for await (const user of users) {
    const now = new Date();
    await db
      .collection('credentials')
      .updateOne(
        { userId: user._id.toString(), type: PASSWORD_TYPE },
        { $setOnInsert: { secretHash: user.passwordHash, createdAt: now, updatedAt: now } },
        { upsert: true },
      );
    await db.collection('users').updateOne({ _id: user._id }, { $unset: { passwordHash: '' } });
  }
};

export const down = async (db) => {
  const credentials = db.collection('credentials').find({ type: PASSWORD_TYPE });
  for await (const credential of credentials) {
    await db
      .collection('users')
      .updateOne({ _id: new Types.ObjectId(credential.userId) }, { $set: { passwordHash: credential.secretHash } });
  }
  await db.collection('credentials').deleteMany({ type: PASSWORD_TYPE });
  await db.collection('credentials').dropIndex(INDEX[1].name);
};
