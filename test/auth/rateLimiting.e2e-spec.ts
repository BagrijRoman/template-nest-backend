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
    // A distinct email per attempt: the per-IP throttler must trip, not the per-account lockout.
    const signIn = (attempt: number) =>
      request(app.getHttpServer())
        .post('/auth/sign-in')
        .send({
          email: `ratelimit.${attempt}@example.com`,
          password: 'Secret123',
        });

    // The accounts do not exist — each attempt burns the limit with a generic 401.
    for (let attempt = 0; attempt < AUTH_THROTTLE_LIMIT; attempt += 1) {
      await signIn(attempt).expect(401);
    }

    const response = await signIn(AUTH_THROTTLE_LIMIT).expect(429);

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
