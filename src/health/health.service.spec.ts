import { ServiceUnavailableException } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { STATES } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  let service: HealthService;
  const connection = { readyState: STATES.connected };

  beforeEach(async () => {
    connection.readyState = STATES.connected;

    const module: TestingModule = await Test.createTestingModule({
      providers: [HealthService, { provide: getConnectionToken(), useValue: connection }],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('reports ok when the database connection is up', () => {
    const health = service.check();

    expect(health.status).toBe('ok');
    expect(health.database).toBe('up');
    expect(health.uptime).toBeGreaterThanOrEqual(0);
    expect(new Date(health.timestamp).toISOString()).toBe(health.timestamp);
  });

  it('throws 503 when the database connection is down', () => {
    connection.readyState = STATES.disconnected;

    expect(() => service.check()).toThrow(ServiceUnavailableException);
  });
});
