import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module.js';
import { setupApp } from '../../src/app.setup.js';
import { AUTH_THROTTLE_LIMIT } from '../../src/auth/auth.constants.js';

const FIRST_CLIENT = '203.0.113.10';
const SECOND_CLIENT = '203.0.113.20';

// ConfigModule snapshots env when AppModule is imported, so the variable must exist before imports run.
vi.hoisted(() => {
  process.env.TRUST_PROXY = '1';
});

describe('TRUST_PROXY behind one proxy (e2e)', () => {
  let app: INestApplication<Server>;

  // Each attempt uses its own email, so the per-IP throttler trips rather than the per-account lockout.
  const signIn = (clientIp: string, attempt: number) =>
    request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('X-Forwarded-For', clientIp)
      .send({
        email: `trustproxy.${clientIp}.${attempt}@example.com`,
        password: 'Secret123',
      });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(() => {
    delete process.env.TRUST_PROXY;
  });

  it('counts each forwarded client separately, so one flood cannot lock out everyone else', async () => {
    // The accounts do not exist — every attempt burns the limit with a generic 401.
    for (let attempt = 0; attempt < AUTH_THROTTLE_LIMIT; attempt += 1) {
      await signIn(FIRST_CLIENT, attempt).expect(401);
    }
    await signIn(FIRST_CLIENT, AUTH_THROTTLE_LIMIT).expect(429);

    await signIn(SECOND_CLIENT, 0).expect(401);
  });
});
