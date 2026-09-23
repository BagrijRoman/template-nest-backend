import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module.js';
import { MAX_FAILED_SIGN_IN_ATTEMPTS } from '../../src/auth/auth.constants.js';

describe('Sign-in lockout (e2e)', () => {
  let app: INestApplication<Server>;
  let connection: Connection;

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const email = 'lockout.jane@example.com';
  const password = 'Secret123';

  const signIn = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/sign-in').send(body);
  const failTimes = async (attemptEmail: string, times: number) => {
    for (let attempt = 0; attempt < times; attempt += 1) {
      await signIn({ email: attemptEmail, password: 'Wrong1234' }).expect(401);
    }
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    await connection.collection('users').deleteMany({ email });
    // Only this file's emails: e2e files run in parallel against the same database.
    await connection
      .collection('signinattempts')
      .deleteMany({ email: /^lockout\./ });

    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email, firstName: 'Jane', lastName: 'Doe', password })
      .expect(201);
  });

  afterEach(async () => {
    await app.close();
  });

  it(`locks the email after ${MAX_FAILED_SIGN_IN_ATTEMPTS} failed attempts — even the correct password gets 429`, async () => {
    await failTimes(email, MAX_FAILED_SIGN_IN_ATTEMPTS);

    const response = await signIn({ email, password }).expect(429);

    expect(response.body).toMatchObject({
      statusCode: 429,
      code: 'ACCOUNT_LOCKED',
      message: 'Too many failed sign-in attempts, try again later',
      meta: { retryAfterSeconds: expect.any(Number) },
      path: '/auth/sign-in',
    });
  });

  it('locks unknown emails identically, so lockout cannot probe account existence', async () => {
    const unknownEmail = 'lockout.ghost@example.com';
    await failTimes(unknownEmail, MAX_FAILED_SIGN_IN_ATTEMPTS);

    await signIn({ email: unknownEmail, password }).expect(429);
  });

  it('keeps other emails unaffected by one email being locked', async () => {
    await failTimes('lockout.other@example.com', MAX_FAILED_SIGN_IN_ATTEMPTS);

    await signIn({ email, password }).expect(200);
  });

  it('resets the counter on a successful sign-in', async () => {
    await failTimes(email, MAX_FAILED_SIGN_IN_ATTEMPTS - 1);
    await signIn({ email, password }).expect(200);

    // Without the reset this failure would be the locking one — 200 proves a fresh slate.
    await failTimes(email, 1);
    await signIn({ email, password }).expect(200);
  });
});
