import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module.js';
import { setupApp } from '../../src/app.setup.js';
import { AUTH_THROTTLE_LIMIT } from '../../src/auth/auth.constants.js';

const FORGED_CLIENT = '203.0.113.30';
const OTHER_FORGED_CLIENT = '203.0.113.40';

// No TRUST_PROXY: the default, and the configuration an app exposed directly must run with.
describe('TRUST_PROXY unset (e2e)', () => {
  let app: INestApplication<Server>;

  const signIn = (clientIp: string, attempt: number) =>
    request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('X-Forwarded-For', clientIp)
      .send({
        email: `notrustproxy.${clientIp}.${attempt}@example.com`,
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

  it('ignores X-Forwarded-For, so a forged header cannot hand the caller a fresh rate-limit bucket', async () => {
    for (let attempt = 0; attempt < AUTH_THROTTLE_LIMIT; attempt += 1) {
      await signIn(FORGED_CLIENT, attempt).expect(401);
    }
    await signIn(FORGED_CLIENT, AUTH_THROTTLE_LIMIT).expect(429);

    // Same socket, new header value: still the same bucket.
    await signIn(OTHER_FORGED_CLIENT, 0).expect(429);
  });
});
