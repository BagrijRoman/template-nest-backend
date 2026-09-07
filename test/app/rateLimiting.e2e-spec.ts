import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';
import { BURST_THROTTLE_LIMIT } from '../../src/common/constants.js';

const FLOOD_OVERSHOOT = 10;

describe('Global burst rate limiting (e2e)', () => {
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

  it('cuts off a request flood with 429', async () => {
    const statuses: number[] = [];
    for (
      let attempt = 0;
      attempt < BURST_THROTTLE_LIMIT + FLOOD_OVERSHOOT;
      attempt += 1
    ) {
      const response = await request(app.getHttpServer()).get('/');
      statuses.push(response.status);
    }

    const served = statuses.filter((status) => status === 200);
    const rejected = statuses.filter((status) => status === 429);

    expect(statuses[0]).toBe(200);
    expect(served.length).toBeLessThanOrEqual(BURST_THROTTLE_LIMIT);
    expect(rejected.length).toBeGreaterThan(0);
  });
});
