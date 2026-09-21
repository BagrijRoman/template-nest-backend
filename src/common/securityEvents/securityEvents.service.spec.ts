import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecurityEvent, SecurityEventsService } from './securityEvents.service.js';

const EMAIL = 'jane@example.com';

describe('SecurityEventsService', () => {
  let service: SecurityEventsService;

  const pinoLogger = { info: vi.fn(), warn: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SecurityEventsService, { provide: getLoggerToken(SecurityEventsService.name), useValue: pinoLogger }],
    }).compile();

    service = module.get<SecurityEventsService>(SecurityEventsService);
  });

  it('records routine events at info level with the machine-readable event field', () => {
    service.record(SecurityEvent.SignInSucceeded, { userId: 'user-1' });

    expect(pinoLogger.info).toHaveBeenCalledWith(
      { event: 'auth.sign_in_succeeded', userId: 'user-1' },
      'Security event: auth.sign_in_succeeded',
    );
    expect(pinoLogger.warn).not.toHaveBeenCalled();
  });

  it('records suspicious events at warn level so alerting can key on the level', () => {
    for (const event of [
      SecurityEvent.SignInLocked,
      SecurityEvent.RefreshTokenReuseDetected,
      SecurityEvent.BreachedPasswordRejected,
    ]) {
      service.record(event, { userId: 'user-1' });
    }

    expect(pinoLogger.warn).toHaveBeenCalledTimes(3);
    expect(pinoLogger.info).not.toHaveBeenCalled();
  });

  it('never logs a raw email — only a stable truncated hash', () => {
    service.record(SecurityEvent.SignInFailed, { email: EMAIL });
    service.record(SecurityEvent.SignInFailed, { email: EMAIL });

    const [firstPayload] = pinoLogger.info.mock.calls[0];
    const [secondPayload] = pinoLogger.info.mock.calls[1];
    expect(firstPayload.email).toBeUndefined();
    expect(firstPayload.emailHash).toMatch(/^[0-9a-f]{16}$/);
    expect(firstPayload.emailHash).not.toContain('jane');
    // Stable across events, so one account's events can still be grouped.
    expect(firstPayload.emailHash).toBe(secondPayload.emailHash);
  });
});
