import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';
import { BODY_SIZE_LIMIT_BYTES, setupApp } from '../../src/app.setup.js';

describe('Request body size limit (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Mirrors main.ts: the default parser is off, setupApp registers the limited one.
    app = moduleFixture.createNestApplication({ bodyParser: false });
    setupApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects a body above the limit with 413 and the standard error shape', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({
        email: 'body.limit@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        password: 'A'.repeat(BODY_SIZE_LIMIT_BYTES),
      })
      .expect(413);

    expect(response.body).toMatchObject({
      statusCode: 413,
      error: 'Payload Too Large',
      path: '/auth/sign-up',
    });
    expect(response.body.timestamp).toBeDefined();
  });

  it('serves a normal-sized body through the same parsers', async () => {
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({
        email: 'body.limit@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        password: 'Secret123',
      })
      .expect(201);
  });
});
