import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';

const JWT_PATTERN = /^[\w-]+\.[\w-]+\.[\w-]+$/;

describe('POST /auth/refresh (e2e)', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let userId: string;
  let refreshToken: string;

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const email = 'refresh.jane@example.com';

  const refresh = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/refresh').send(body);

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
      .send({
        email,
        firstName: 'Jane',
        lastName: 'Doe',
        password: 'Secret123',
      })
      .expect(201);
    userId = signUpResponse.body.user.id;
    refreshToken = signUpResponse.body.refreshToken;
  });

  afterEach(async () => {
    await app.close();
  });

  it('exchanges a valid refresh token for a fresh pair', async () => {
    const response = await refresh({ refreshToken }).expect(200);

    expect(response.body.accessToken).toMatch(JWT_PATTERN);
    expect(response.body.refreshToken).toMatch(JWT_PATTERN);
    expect(response.body.refreshToken).not.toBe(refreshToken);
    expect(response.body.user.id).toBe(userId);
    expect(JSON.stringify(response.body)).not.toContain('assword');
  });

  it('rotates: the redeemed token is dead, the fresh one keeps working', async () => {
    const firstResponse = await refresh({ refreshToken }).expect(200);

    await refresh({ refreshToken }).expect(401);
    await refresh({ refreshToken: firstResponse.body.refreshToken }).expect(
      200,
    );
  });

  it('answers every unredeemable token with the same generic 401', async () => {
    const reused = await refresh({ refreshToken }).then(() =>
      refresh({ refreshToken }).expect(401),
    );
    const forged = await refresh({ refreshToken: 'for.ged.token' }).expect(401);

    expect(reused.body.message).toBe('Invalid refresh token');
    const withoutTimestamp = ({
      timestamp: _timestamp,
      ...rest
    }: Record<string, unknown>) => rest;
    expect(withoutTimestamp(reused.body)).toEqual(
      withoutTimestamp(forged.body),
    );
  });

  it('replaces the stored hash on rotation instead of accumulating records', async () => {
    const before = await connection
      .collection('refreshtokens')
      .find({ userId })
      .toArray();
    expect(before).toHaveLength(1);

    await refresh({ refreshToken }).expect(200);

    const after = await connection
      .collection('refreshtokens')
      .find({ userId })
      .toArray();
    expect(after).toHaveLength(1);
    expect(after[0].tokenHash).not.toBe(before[0].tokenHash);
  });

  it('lets only one of two concurrent redemptions of the same token win', async () => {
    const responses = await Promise.all([
      refresh({ refreshToken }),
      refresh({ refreshToken }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 401,
    ]);
  });

  it('rejects a refresh token whose account was deleted', async () => {
    await connection.collection('users').deleteMany({ email });

    const response = await refresh({ refreshToken }).expect(401);
    expect(response.body.message).toBe('Invalid refresh token');
  });

  it('rejects an access token presented as a refresh token', async () => {
    const signInResponse = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email, password: 'Secret123' })
      .expect(200);

    await refresh({ refreshToken: signInResponse.body.accessToken }).expect(
      401,
    );
  });

  it('rejects an empty token with 400 and the standard error shape', async () => {
    const response = await refresh({ refreshToken: '' }).expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      path: '/auth/refresh',
    });
  });
});
