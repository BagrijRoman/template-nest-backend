import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';

describe('POST /auth/change-password (e2e)', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let accessToken: string;
  let refreshToken: string;

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const email = 'changepw.jane@example.com';
  const password = 'Secret123';
  const newPassword = 'NewSecret456';

  const changePassword = (body: Record<string, unknown>, token = accessToken) =>
    request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    await connection.collection('users').deleteMany({ email });
    await connection.collection('signinattempts').deleteMany({ email });

    const signUpResponse = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email, firstName: 'Jane', lastName: 'Doe', password })
      .expect(201);
    accessToken = signUpResponse.body.accessToken;
    refreshToken = signUpResponse.body.refreshToken;
  });

  afterEach(async () => {
    await app.close();
  });

  it('changes the password: the old one stops working, the new one signs in', async () => {
    await changePassword({ currentPassword: password, newPassword }).expect(
      200,
    );

    await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email, password })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email, password: newPassword })
      .expect(200);
  });

  it('revokes every other session and hands the caller a working fresh one', async () => {
    const otherDevice = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email, password })
      .expect(200);

    const response = await changePassword({
      currentPassword: password,
      newPassword,
    }).expect(200);

    // Both pre-change refresh tokens are dead; the returned pair works.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: otherDevice.body.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: response.body.refreshToken })
      .expect(200);
  });

  it('rejects a wrong current password with 400 without revoking sessions', async () => {
    const response = await changePassword({
      currentPassword: 'Wrong1234',
      newPassword,
    }).expect(400);

    expect(response.body.message).toBe('Current password is incorrect');
    expect(response.body.code).toBe('WRONG_CURRENT_PASSWORD');
    expect(response.body.details).toEqual([
      {
        field: 'currentPassword',
        rule: 'matchesCurrentPassword',
        message: 'Current password is incorrect',
      },
    ]);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);
  });

  it('counts wrong current passwords toward the sign-in lockout', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await changePassword({
        currentPassword: 'Wrong1234',
        newPassword,
      }).expect(400);
    }

    await changePassword({ currentPassword: password, newPassword }).expect(
      429,
    );
  });

  it('demands an access token — the route is not public', async () => {
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .send({ currentPassword: password, newPassword })
      .expect(401);
  });

  it('validates the new password strength', async () => {
    const response = await changePassword({
      currentPassword: password,
      newPassword: 'weak',
    }).expect(400);

    expect(response.body.message).toBe('Validation failed');
    expect(response.body.details).toContainEqual(
      expect.objectContaining({
        message: 'newPassword must be at least 8 characters long',
      }),
    );
  });
});
