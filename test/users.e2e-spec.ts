import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('Users registration (e2e)', () => {
  let app: INestApplication<App>;

  const validBody = { email: 'jane@example.com', name: 'Jane', password: 'Secret123' };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('registers a user and never returns the password', async () => {
    const response = await request(app.getHttpServer()).post('/users/register').send(validBody).expect(201);

    expect(response.body.id).toBeDefined();
    expect(response.body.email).toBe('jane@example.com');
    expect(response.body.name).toBe('Jane');
    expect(response.body.passwordHash).toBeUndefined();
    expect(response.body.password).toBeUndefined();
  });

  it('normalizes the email', async () => {
    const response = await request(app.getHttpServer())
      .post('/users/register')
      .send({ ...validBody, email: '  Jane@Example.COM ' })
      .expect(201);

    expect(response.body.email).toBe('jane@example.com');
  });

  it('rejects an invalid email with the standard error shape', async () => {
    const response = await request(app.getHttpServer())
      .post('/users/register')
      .send({ ...validBody, email: 'not-an-email' })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      path: '/users/register',
    });
    expect(response.body.details).toContain('email must be a valid email address');
    expect(response.body.timestamp).toBeDefined();
  });

  it.each([
    ['too short', 'Ab1', 'password must be at least 8 characters long'],
    ['no uppercase', 'secret123', 'password must contain at least one uppercase letter'],
    ['no lowercase', 'SECRET123', 'password must contain at least one lowercase letter'],
    ['no digit', 'SecretPass', 'password must contain at least one digit'],
  ])('rejects a weak password (%s)', async (_label, password, expectedError) => {
    const response = await request(app.getHttpServer())
      .post('/users/register')
      .send({ ...validBody, password })
      .expect(400);

    expect(response.body.message).toBe('Validation failed');
    expect(response.body.details).toContain(expectedError);
  });

  it('rejects a duplicate email with 409 and the standard error shape', async () => {
    await request(app.getHttpServer()).post('/users/register').send(validBody).expect(201);

    const response = await request(app.getHttpServer()).post('/users/register').send(validBody).expect(409);

    expect(response.body).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      message: 'User with email "jane@example.com" already exists',
      path: '/users/register',
    });
  });

  it('strips unknown fields from the payload', async () => {
    const response = await request(app.getHttpServer())
      .post('/users/register')
      .send({ ...validBody, isAdmin: true })
      .expect(201);

    expect(response.body.isAdmin).toBeUndefined();
  });
});
