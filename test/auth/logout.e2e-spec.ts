import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module.js';

describe('POST /auth/logout (e2e)', () => {
  let app: INestApplication<Server>;
  let connection: Connection;
  let refreshToken: string;

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const email = 'logout.jane@example.com';

  const logout = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/logout').send(body);

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
    refreshToken = signUpResponse.body.refreshToken;
  });

  afterEach(async () => {
    await app.close();
  });

  it('revokes the refresh token: 204, and the token can no longer be redeemed', async () => {
    await logout({ refreshToken }).expect(204);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('is idempotent: logging out twice (or with garbage) still answers 204', async () => {
    await logout({ refreshToken }).expect(204);
    await logout({ refreshToken }).expect(204);
    await logout({ refreshToken: 'not.a.token' }).expect(204);
  });

  it('returns an empty body on success', async () => {
    const response = await logout({ refreshToken }).expect(204);

    expect(response.body).toEqual({});
  });

  it('rejects an empty token with 400 and the standard error shape', async () => {
    const response = await logout({ refreshToken: '' }).expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      path: '/auth/logout',
    });
  });
});
