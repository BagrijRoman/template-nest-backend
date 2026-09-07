import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';
import { AUTH_THROTTLE_LIMIT } from '../../src/auth/auth.constants.js';

describe('Auth rate limiting (e2e)', () => {
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

  it(`returns 429 after ${AUTH_THROTTLE_LIMIT} auth requests within the window`, async () => {
    const signIn = () =>
      request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({ email: 'auth.jane@example.com', password: 'Secret123' });

    for (let attempt = 0; attempt < AUTH_THROTTLE_LIMIT; attempt += 1) {
      await signIn().expect(501);
    }

    const response = await signIn().expect(429);

    expect(response.body).toMatchObject({
      statusCode: 429,
      path: '/auth/sign-in',
    });
    expect(response.body.timestamp).toBeDefined();
  });

  it('does not rate limit the health endpoint', async () => {
    for (let attempt = 0; attempt < AUTH_THROTTLE_LIMIT + 5; attempt += 1) {
      await request(app.getHttpServer()).get('/health').expect(200);
    }
  });
});
