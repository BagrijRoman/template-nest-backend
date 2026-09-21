import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';
import { BreachedPasswordsService } from '../../src/users/breachedPasswords.service.js';

// The external HIBP API is disabled for e2e runs (test/setup/mongoMemoryServer.ts); this spec
// overrides the provider to verify the wiring: a breached verdict must block password-setting flows.
describe('Breached password rejection (e2e)', () => {
  let app: INestApplication<App>;

  // Email is unique to this spec file: e2e files run in parallel against the same database.
  const email = 'breached.jane@example.com';

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BreachedPasswordsService)
      .useValue({ isBreached: () => Promise.resolve(true) })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects sign-up with a breached password using the standard error shape', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({
        email,
        firstName: 'Jane',
        lastName: 'Doe',
        password: 'Secret123',
      })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      code: 'BREACHED_PASSWORD',
      details: [{ field: 'password', rule: 'notBreached' }],
      message:
        'This password has appeared in a known data breach — please choose a different one',
      path: '/auth/sign-up',
    });
  });
});
