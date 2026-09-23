import mongoose from 'mongoose';
import { down, up } from '../../migrations/20260923100000-user-roles.js';

describe('user-roles migration (e2e)', () => {
  let connection: mongoose.Connection;
  const db = () => connection.db!;

  beforeAll(async () => {
    connection = await mongoose
      .createConnection(process.env.MONGODB_URI ?? '', {
        dbName: 'user-roles-migration-test',
      })
      .asPromise();
  });

  beforeEach(async () => {
    await db().collection('users').deleteMany({});
    await db()
      .collection('users')
      .insertMany([
        { email: 'legacy@example.com' },
        { email: 'admin@example.com', role: 'admin' },
      ]);
  });

  afterAll(async () => {
    await connection.close();
  });

  it('backfills plain users without touching existing roles, idempotently', async () => {
    await up(db());
    await up(db());

    const roles = await db()
      .collection('users')
      .find({}, { projection: { _id: 0, email: 1, role: 1 } })
      .sort({ email: 1 })
      .toArray();
    expect(roles).toEqual([
      { email: 'admin@example.com', role: 'admin' },
      { email: 'legacy@example.com', role: 'user' },
    ]);
  });

  it('down removes the field again', async () => {
    await up(db());
    await down(db());

    const withRole = await db()
      .collection('users')
      .countDocuments({ role: { $exists: true } });
    expect(withRole).toBe(0);
  });
});
