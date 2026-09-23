// Backfills `role` on users created before the field existed: they are plain users.
// Idempotent: users that already carry a role are left untouched.
export const up = async (db) => {
  await db.collection('users').updateMany({ role: { $exists: false } }, { $set: { role: 'user' } });
};

export const down = async (db) => {
  await db.collection('users').updateMany({}, { $unset: { role: '' } });
};
