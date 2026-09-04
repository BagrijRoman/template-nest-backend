import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';

describe('Scaffolded auth endpoints (e2e)', () => {
  let app: INestApplication<App>;

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

  it('POST /auth/sign-in should return 501 until implemented', () => {
    return request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'auth.jane@example.com', password: 'Secret123' })
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
