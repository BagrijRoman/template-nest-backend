import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/;
// `salt:hash` produced by password.util.ts: 16-byte salt and 64-byte key, hex-encoded.
const PASSWORD_HASH_PATTERN = /^[0-9a-f]{32}:[0-9a-f]{128}$/;
const JWT_PATTERN = /^[\w-]+\.[\w-]+\.[\w-]+$/;

describe('POST /auth/sign-up (e2e)', () => {
  let app: INestApplication<App>;
  let connection: Connection;

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const email = 'auth.jane@example.com';
  const validBody = {
    email,
    firstName: 'Jane',
    lastName: 'Doe',
    password: 'Secret123',
  };

  const signUp = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/sign-up').send(body);

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    await connection.collection('users').deleteMany({ email });
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a user and returns a token pair with its public shape', async () => {
    const response = await signUp(validBody).expect(201);

    expect(response.body.accessToken).toMatch(JWT_PATTERN);
    expect(response.body.refreshToken).toMatch(JWT_PATTERN);
    expect(response.body.user.id).toMatch(OBJECT_ID_PATTERN);
    expect(response.body.user.email).toBe(email);
    expect(response.body.user.firstName).toBe('Jane');
    expect(response.body.user.lastName).toBe('Doe');
    expect(response.body.user.createdAt).toBeDefined();
    expect(response.body.user.updatedAt).toBeDefined();
  });

  it('never returns the password or its hash to the client', async () => {
    const response = await signUp(validBody).expect(201);

    expect(JSON.stringify(response.body)).not.toContain('assword');
  });

  it('persists the user with a hashed password, not the plaintext one', async () => {
    await signUp(validBody).expect(201);

    const persisted = await connection.collection('users').findOne({ email });
    expect(persisted).not.toBeNull();
    expect(persisted?.passwordHash).toMatch(PASSWORD_HASH_PATTERN);
    expect(persisted?.password).toBeUndefined();
  });

  it('rejects a duplicate email with 409 and the standard error shape', async () => {
    await signUp(validBody).expect(201);

    const response = await signUp(validBody).expect(409);

    expect(response.body).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      code: 'EMAIL_TAKEN',
      message: `User with email "${email}" already exists`,
      details: [{ field: 'email', rule: 'unique' }],
      path: '/auth/sign-up',
    });
    expect(response.body.timestamp).toBeDefined();
  });

  it('rejects a duplicate email that differs only in case', async () => {
    await signUp(validBody).expect(201);

    await signUp({ ...validBody, email: 'Auth.Jane@Example.COM' }).expect(409);
  });

  it('normalizes the email', async () => {
    const response = await signUp({
      ...validBody,
      email: '  Auth.Jane@Example.COM ',
    }).expect(201);

    expect(response.body.user.email).toBe(email);
  });

  it('trims first and last names', async () => {
    const response = await signUp({
      ...validBody,
      firstName: '  Jane ',
      lastName: '  Doe ',
    }).expect(201);

    expect(response.body.user.firstName).toBe('Jane');
    expect(response.body.user.lastName).toBe('Doe');
  });

  it('rejects an invalid email with the standard error shape', async () => {
    const response = await signUp({
      ...validBody,
      email: 'not-an-email',
    }).expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      path: '/auth/sign-up',
    });
    expect(response.body.details).toContainEqual(
      expect.objectContaining({
        message: 'email must be a valid email address',
      }),
    );
    expect(response.body.timestamp).toBeDefined();
  });

  it.each([
    ['too short', 'Ab1', 'password must be at least 8 characters long'],
    [
      'no uppercase',
      'secret123',
      'password must contain at least one uppercase letter',
    ],
    [
      'no lowercase',
      'SECRET123',
      'password must contain at least one lowercase letter',
    ],
    ['no digit', 'SecretPass', 'password must contain at least one digit'],
  ])(
    'rejects a weak password (%s)',
    async (_label, password, expectedError) => {
      const response = await signUp({ ...validBody, password }).expect(400);

      expect(response.body.message).toBe('Validation failed');
      expect(response.body.details).toContainEqual(
        expect.objectContaining({ message: expectedError }),
      );
    },
  );

  it.each([
    [
      'email',
      { email: `${'a'.repeat(200)}@example.com` },
      'email must be a valid email address',
    ],
    [
      'password',
      { password: `Aa1${'a'.repeat(126)}` },
      'password must be shorter than or equal to 128 characters',
    ],
    [
      'firstName',
      { firstName: 'J'.repeat(101) },
      'firstName must be shorter than or equal to 100 characters',
    ],
    [
      'lastName',
      { lastName: 'D'.repeat(101) },
      'lastName must be shorter than or equal to 100 characters',
    ],
  ])('rejects an overly long %s', async (_field, override, expectedError) => {
    const response = await signUp({ ...validBody, ...override }).expect(400);

    expect(response.body.message).toBe('Validation failed');
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ message: expectedError }),
    );
  });

  it.each([
    [
      'missing firstName',
      { firstName: undefined },
      'firstName must not be empty',
    ],
    [
      'whitespace-only firstName',
      { firstName: '   ' },
      'firstName must not be empty',
    ],
    ['missing lastName', { lastName: undefined }, 'lastName must not be empty'],
    [
      'whitespace-only lastName',
      { lastName: '   ' },
      'lastName must not be empty',
    ],
  ])('rejects a name problem (%s)', async (_label, override, expectedError) => {
    const response = await signUp({ ...validBody, ...override }).expect(400);

    expect(response.body.message).toBe('Validation failed');
    expect(response.body.details).toContainEqual(
      expect.objectContaining({ message: expectedError }),
    );
  });

  it('strips unknown fields from the payload', async () => {
    const response = await signUp({ ...validBody, isAdmin: true }).expect(201);

    expect(response.body.user.isAdmin).toBeUndefined();
  });
});
