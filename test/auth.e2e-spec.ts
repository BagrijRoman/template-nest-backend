import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('Auth endpoints scaffold (e2e)', () => {
  let app: INestApplication<App>;

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const credentials = { email: 'auth.jane@example.com', password: 'Secret123' };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    const connection = app.get<Connection>(getConnectionToken());
    await connection
      .collection('users')
      .deleteMany({ email: credentials.email });
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /auth/sign-up should create a user', () => {
    return request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ ...credentials, firstName: 'Jane', lastName: 'Doe' })
      .expect(201);
  });

  it('POST /auth/sign-up should return 400 on invalid body', () => {
    return request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'not-an-email', firstName: '', password: 'short' })
      .expect(400);
  });

  it('POST /auth/sign-in should return 501 until implemented', () => {
    return request(app.getHttpServer())
      .post('/auth/sign-in')
      .send(credentials)
      .expect(501);
  });

  it('POST /auth/sign-in should return 400 on invalid body', () => {
    return request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'not-an-email' })
      .expect(400);
  });

  it('POST /auth/refresh should return 501 until implemented', () => {
    return request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'some-refresh-token' })
      .expect(501);
  });

  it('POST /auth/refresh should return 400 on empty token', () => {
    return request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: '' })
      .expect(400);
  });

  it('POST /auth/logout should return 501 until implemented', () => {
    return request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: 'some-refresh-token' })
      .expect(501);
  });
});
