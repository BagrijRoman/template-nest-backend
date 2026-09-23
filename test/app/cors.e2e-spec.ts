import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module.js';
import { setupApp } from '../../src/app.setup.js';

const ALLOWED_ORIGIN = 'http://localhost:5173';
const DISALLOWED_ORIGIN = 'http://evil.example.com';

// ConfigModule snapshots env when AppModule is imported, so the variable must exist before imports run.
vi.hoisted(() => {
  process.env.CORS_ORIGINS = 'http://localhost:5173';
});

describe('CORS whitelist (e2e)', () => {
  let app: INestApplication<Server>;

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
    delete process.env.CORS_ORIGINS;
  });

  it('allows a whitelisted origin and permits credentials', async () => {
    const response = await request(app.getHttpServer())
      .get('/health-check')
      .set('Origin', ALLOWED_ORIGIN)
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(
      ALLOWED_ORIGIN,
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('sends no allow-origin header to an origin outside the whitelist', async () => {
    const response = await request(app.getHttpServer())
      .get('/health-check')
      .set('Origin', DISALLOWED_ORIGIN)
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a preflight request for a whitelisted origin', async () => {
    const response = await request(app.getHttpServer())
      .options('/auth/sign-up')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(
      ALLOWED_ORIGIN,
    );
  });

  it('serves requests without an Origin header as usual', async () => {
    const response = await request(app.getHttpServer())
      .get('/health-check')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
