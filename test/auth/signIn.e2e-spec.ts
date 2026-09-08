import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';

const JWT_PATTERN = /^[\w-]+\.[\w-]+\.[\w-]+$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

describe('POST /auth/sign-in (e2e)', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let userId: string;

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const email = 'signin.jane@example.com';
  const password = 'Secret123';

  const signIn = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/sign-in').send(body);

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
    userId = signUpResponse.body.user.id;
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns a token pair and the public user shape for valid credentials', async () => {
    const response = await signIn({ email, password }).expect(200);

    expect(response.body.accessToken).toMatch(JWT_PATTERN);
    expect(response.body.refreshToken).toMatch(JWT_PATTERN);
    expect(response.body.user.id).toBe(userId);
    expect(response.body.user.email).toBe(email);
    expect(JSON.stringify(response.body)).not.toContain('assword');
  });

  it('persists only sha256 hashes of issued refresh tokens, never the tokens themselves', async () => {
    const response = await signIn({ email, password }).expect(200);

    // One record from the sign-up in beforeEach, one from this sign-in.
    const records = await connection
      .collection('refreshtokens')
      .find({ userId })
      .toArray();
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.tokenHash).toMatch(SHA256_HEX_PATTERN);
      expect(record.expiresAt).toBeInstanceOf(Date);
    }
    expect(records.map((record) => record.tokenHash)).not.toContain(
      response.body.refreshToken,
    );
  });

  it('answers an unknown email and a wrong password with the same generic 401', async () => {
    const unknownEmail = await signIn({
      email: 'missing.jane@example.com',
      password,
    }).expect(401);
    const wrongPassword = await signIn({ email, password: 'Wrong1234' }).expect(
      401,
    );

    expect(unknownEmail.body.message).toBe('Invalid email or password');
    // Identical bodies except the timestamp: nothing distinguishes the two failure causes.
    const withoutTimestamp = ({
      timestamp: _timestamp,
      ...rest
    }: Record<string, unknown>) => rest;
    expect(withoutTimestamp(unknownEmail.body)).toEqual(
      withoutTimestamp(wrongPassword.body),
    );
  });

  it('normalizes the email before checking credentials', async () => {
    await signIn({ email: '  SignIn.Jane@Example.COM ', password }).expect(200);
  });

  it('rejects an invalid body with 400 and the standard error shape', async () => {
    const response = await signIn({ email: 'not-an-email' }).expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      path: '/auth/sign-in',
    });
  });
});
