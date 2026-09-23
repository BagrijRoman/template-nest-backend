import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module.js';

describe('GET /users (e2e)', () => {
  let app: INestApplication<Server>;
  let connection: Connection;
  let adminToken: string;
  let userToken: string;

  // Emails are unique to this spec file: e2e files run in parallel against the same database.
  const adminEmail = 'list.admin@example.com';
  const userEmail = 'list.user@example.com';

  const signUp = async (email: string): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({
        email,
        firstName: 'Jane',
        lastName: 'Doe',
        password: 'Secret123',
      })
      .expect(201);
    return response.body.accessToken;
  };

  const list = (query = '') =>
    request(app.getHttpServer()).get(`/users${query}`);

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    await connection
      .collection('users')
      .deleteMany({ email: { $in: [adminEmail, userEmail] } });

    adminToken = await signUp(adminEmail);
    userToken = await signUp(userEmail);
    // Roles are granted by the operator CLI, never through the API — promote directly in the store.
    await connection
      .collection('users')
      .updateOne({ email: adminEmail }, { $set: { role: 'admin' } });
  });

  afterEach(async () => {
    await app.close();
  });

  it('signs everyone up as a plain user', async () => {
    const response = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(response.body.role).toBe('user');
  });

  it('pages users for an admin, newest first, with the total', async () => {
    const response = await list('?limit=1&offset=0')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toMatchObject({ limit: 1, offset: 0 });
    expect(response.body.total).toBeGreaterThanOrEqual(2);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      email: userEmail,
      role: 'user',
    });
    expect(JSON.stringify(response.body)).not.toContain('assword');
  });

  it('applies the default page size when no query is given', async () => {
    const response = await list()
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toMatchObject({ limit: 20, offset: 0 });
  });

  it('rejects an invalid page query with 400 and field details', async () => {
    const response = await list('?limit=0&offset=abc')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.details).toContainEqual(
      expect.objectContaining({
        field: 'limit',
        message: 'limit must be at least 1',
      }),
    );
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'offset' }),
    );
  });

  it('rejects a plain user with 403 and the standard error shape', async () => {
    const response = await list()
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    expect(response.body).toMatchObject({
      statusCode: 403,
      error: 'Forbidden',
      code: 'FORBIDDEN',
      message: 'Insufficient permissions',
      path: '/users',
    });
  });

  it('takes a role change into account immediately, without a new token', async () => {
    await connection
      .collection('users')
      .updateOne({ email: adminEmail }, { $set: { role: 'user' } });

    await list().set('Authorization', `Bearer ${adminToken}`).expect(403);
  });

  it('rejects an unauthenticated caller with 401 before checking any role', async () => {
    await list().expect(401);
  });
});
