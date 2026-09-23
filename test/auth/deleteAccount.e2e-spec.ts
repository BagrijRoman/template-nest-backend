import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module.js';

describe('POST /auth/delete-account (e2e)', () => {
  let app: INestApplication<Server>;
  let connection: Connection;
  let accessToken: string;
  let refreshToken: string;
  let userId: string;

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const email = 'delete.jane@example.com';
  const password = 'Secret123';

  const deleteAccount = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/auth/delete-account')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);

  const countFor = async (
    collection: string,
    filter: Record<string, unknown>,
  ): Promise<number> =>
    connection.collection(collection).countDocuments(filter);

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    await connection.collection('users').deleteMany({ email });

    const signUpResponse = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email, firstName: 'Jane', lastName: 'Doe', password })
      .expect(201);
    accessToken = signUpResponse.body.accessToken;
    refreshToken = signUpResponse.body.refreshToken;
    userId = signUpResponse.body.user.id;
  });

  afterEach(async () => {
    await app.close();
  });

  it('deletes the account and every trace of it, and the tokens stop working', async () => {
    // Sign-up leaves a verification token behind; ask for a reset token too, so both stores are covered.
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email })
      .expect(204);
    expect(await countFor('credentials', { userId })).toBe(1);
    expect(await countFor('emailverificationtokens', { userId })).toBe(1);
    expect(await countFor('passwordresettokens', { userId })).toBe(1);

    await deleteAccount({ currentPassword: password }).expect(204);

    expect(await countFor('users', { email })).toBe(0);
    expect(await countFor('credentials', { userId })).toBe(0);
    expect(await countFor('refreshtokens', { userId })).toBe(0);
    expect(await countFor('emailverificationtokens', { userId })).toBe(0);
    expect(await countFor('passwordresettokens', { userId })).toBe(0);

    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('frees the email for a fresh sign-up', async () => {
    await deleteAccount({ currentPassword: password }).expect(204);

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email, firstName: 'Jane', lastName: 'Doe', password })
      .expect(201);
  });

  it('refuses a wrong current password with 400 and keeps the account', async () => {
    const response = await deleteAccount({
      currentPassword: 'Wrong1234',
    }).expect(400);

    expect(response.body).toMatchObject({ code: 'WRONG_CURRENT_PASSWORD' });
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'currentPassword' }),
    );
    expect(await countFor('users', { email })).toBe(1);
  });

  it('rejects a missing password with 400 and an unauthenticated caller with 401', async () => {
    await deleteAccount({}).expect(400);
    await request(app.getHttpServer())
      .post('/auth/delete-account')
      .send({ currentPassword: password })
      .expect(401);
    expect(await countFor('users', { email })).toBe(1);
  });
});
