import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { STATES } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';

describe('GET /health-check (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('reports service, build and database health', async () => {
    const response = await request(app.getHttpServer())
      .get('/health-check')
      .expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
      uptime: expect.any(Number),
      commit: expect.any(String),
      nodeEnv: 'test',
      database: { status: 'connected', readyState: 1 },
    });
    expect(response.body.uptime).toBeGreaterThanOrEqual(0);
    expect(new Date(response.body.timestamp).toISOString()).toBe(
      response.body.timestamp,
    );
  });

  it('answers without an access token', async () => {
    await request(app.getHttpServer())
      .get('/health-check')
      .set('Authorization', 'Bearer not-a-token')
      .expect(200);
  });

  it('still answers 200 with status error when the database is down', async () => {
    const connection = app.get<Connection>(getConnectionToken());
    vi.spyOn(connection, 'readyState', 'get').mockReturnValue(
      STATES.disconnected,
    );

    const response = await request(app.getHttpServer())
      .get('/health-check')
      .expect(200);

    expect(response.body.status).toBe('error');
    expect(response.body.database).toEqual({
      status: 'disconnected',
      readyState: 0,
    });
  });

  it('is not served on the old /health path', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });
});
