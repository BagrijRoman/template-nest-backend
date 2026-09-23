import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MailService } from '../common/mail/mail.service.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { AccountRateLimitService } from './accountRateLimit.service.js';
import type { UserProfile } from '../users/entities/index.js';
import { AccountActionCounter } from './entities/index.js';

const USER: UserProfile = {
  id: '507f1f77bcf86cd799439011',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const ACTION = 'verification-email';
const LIMIT = 3;
const WINDOW_MS = 15 * 60_000;

describe('AccountRateLimitService', () => {
  let service: AccountRateLimitService;

  const accountActionCounterModel = {
    deleteOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  };
  const mailService = { send: vi.fn() };
  const securityEvents = { record: vi.fn() };

  const consume = () => service.consume(ACTION, USER, LIMIT, WINDOW_MS);

  beforeEach(async () => {
    vi.resetAllMocks();
    accountActionCounterModel.deleteOne.mockResolvedValue({ deletedCount: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountRateLimitService,
        { provide: getModelToken(AccountActionCounter.name), useValue: accountActionCounterModel },
        { provide: MailService, useValue: mailService },
        { provide: SecurityEventsService, useValue: securityEvents },
      ],
    }).compile();

    service = module.get<AccountRateLimitService>(AccountRateLimitService);
  });

  it('allows requests while the count stays within the limit', async () => {
    accountActionCounterModel.findOneAndUpdate.mockResolvedValue({ count: LIMIT });

    expect(await consume()).toBe(true);
    expect(mailService.send).not.toHaveBeenCalled();
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  it('counts atomically under a per-action-per-account key with a fixed window', async () => {
    accountActionCounterModel.findOneAndUpdate.mockResolvedValue({ count: 1 });

    await consume();

    const [filter, update, options] = accountActionCounterModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ key: `${ACTION}:${USER.id}` });
    expect(update.$inc).toEqual({ count: 1 });
    expect(update.$setOnInsert.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(options).toMatchObject({ upsert: true });
    // Stale (expired but unpurged) counters are dropped first so they cannot leak into a new window.
    expect(accountActionCounterModel.deleteOne.mock.calls[0][0]).toMatchObject({ key: `${ACTION}:${USER.id}` });
  });

  it('blocks the first request over the limit and alerts the owner exactly once', async () => {
    accountActionCounterModel.findOneAndUpdate.mockResolvedValue({ count: LIMIT + 1 });

    expect(await consume()).toBe(false);
    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.AccountRateLimitExceeded, {
      userId: USER.id,
      action: ACTION,
    });
    expect(mailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: USER.email, subject: expect.stringContaining('Security alert') }),
    );
  });

  it('keeps blocking further requests without repeating the alert', async () => {
    accountActionCounterModel.findOneAndUpdate.mockResolvedValue({ count: LIMIT + 2 });

    expect(await consume()).toBe(false);
    expect(mailService.send).not.toHaveBeenCalled();
    expect(securityEvents.record).not.toHaveBeenCalled();
  });
});
