import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module.js';

describe('GET /users/me (e2e)', () => {
  let app: INestApplication<Server>;
  let connection: Connection;
  let accessToken: string;
  let refreshToken: string;
  let userId: string;

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const email = 'me.jane@example.com';

  const getMe = () => request(app.getHttpServer()).get('/users/me');

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
    accessToken = signUpResponse.body.accessToken;
    refreshToken = signUpResponse.body.refreshToken;
    userId = signUpResponse.body.user.id;
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the authenticated user for a valid access token', async () => {
    const response = await getMe()
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.id).toBe(userId);
    expect(response.body.email).toBe(email);
    expect(JSON.stringify(response.body)).not.toContain('assword');
  });

  it.each([
    ['no Authorization header', (req: request.Test) => req],
    [
      'a non-bearer scheme',
      (req: request.Test) => req.set('Authorization', 'Basic dXNlcjpwYXNz'),
    ],
    [
      'a garbage token',
      (req: request.Test) => req.set('Authorization', 'Bearer not.a.token'),
    ],
  ])(
    'rejects %s with 401 and the standard error shape',
    async (_label, decorate) => {
      const response = await decorate(getMe()).expect(401);

      expect(response.body).toMatchObject({
        statusCode: 401,
        error: 'Unauthorized',
        code: 'UNAUTHENTICATED',
        message: 'Invalid or missing access token',
        path: '/users/me',
      });
    },
  );

  it('rejects a refresh token presented as an access token', async () => {
    await getMe().set('Authorization', `Bearer ${refreshToken}`).expect(401);
  });

  it('rejects a valid access token whose account was deleted', async () => {
    await connection.collection('users').deleteMany({ email });

    await getMe().set('Authorization', `Bearer ${accessToken}`).expect(401);
  });
});
