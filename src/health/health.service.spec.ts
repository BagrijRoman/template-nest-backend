import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { STATES } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  let service: HealthService;
  const connection = { readyState: STATES.connected };
  const env: Record<string, string | undefined> = {};
  const config = { get: (key: string) => env[key] };

  beforeEach(async () => {
    connection.readyState = STATES.connected;
    env.NODE_ENV = 'production';
    env.GIT_SHA = '0c038234d9aca98fa3469178c7e7d8993beb7a3c';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: getConnectionToken(), useValue: connection },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('reports ok with build info when the database connection is up', () => {
    const health = service.getHealth();

    expect(health.status).toBe('ok');
    expect(health.database).toEqual({ status: 'connected', readyState: 1 });
    expect(health.commit).toBe('0c038234d9aca98fa3469178c7e7d8993beb7a3c');
    expect(health.nodeEnv).toBe('production');
    expect(health.uptime).toBeGreaterThanOrEqual(0);
    expect(new Date(health.timestamp).toISOString()).toBe(health.timestamp);
  });

  it('reports error instead of throwing when the database connection is down', () => {
    connection.readyState = STATES.disconnected;

    const health = service.getHealth();

    expect(health.status).toBe('error');
    expect(health.database).toEqual({ status: 'disconnected', readyState: 0 });
  });

  it('names the in-between connection state', () => {
    connection.readyState = STATES.connecting;

    expect(service.getHealth().database).toEqual({ status: 'connecting', readyState: 2 });
  });

  it('reports unknown commit when GIT_SHA is not set', () => {
    env.GIT_SHA = undefined;

    expect(service.getHealth().commit).toBe('unknown');
  });
});
