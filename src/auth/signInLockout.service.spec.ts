import { HttpException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FAILED_SIGN_IN_ATTEMPTS } from './auth.constants.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { SignInAttempt } from './entities/index.js';
import { SignInLockoutService } from './signInLockout.service.js';

const EMAIL = 'jane@example.com';
const FUTURE = new Date(Date.now() + 60_000);
const PAST = new Date(Date.now() - 60_000);

const withLean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });

describe('SignInLockoutService', () => {
  let service: SignInLockoutService;

  const securityEvents = { record: vi.fn() };
  const signInAttemptModel = {
    deleteOne: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    signInAttemptModel.deleteOne.mockResolvedValue({ deletedCount: 0 });
    signInAttemptModel.findOneAndUpdate.mockResolvedValue({ failedCount: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignInLockoutService,
        { provide: getModelToken(SignInAttempt.name), useValue: signInAttemptModel },
        { provide: SecurityEventsService, useValue: securityEvents },
      ],
    }).compile();

    service = module.get<SignInLockoutService>(SignInLockoutService);
  });

  it('passes when there is no failure record', async () => {
    signInAttemptModel.findOne.mockReturnValue(withLean(null));

    await expect(service.assertNotLocked(EMAIL)).resolves.toBeUndefined();
  });

  it('passes while the failure count is below the limit', async () => {
    signInAttemptModel.findOne.mockReturnValue(
      withLean({ failedCount: MAX_FAILED_SIGN_IN_ATTEMPTS - 1, expiresAt: FUTURE }),
    );

    await expect(service.assertNotLocked(EMAIL)).resolves.toBeUndefined();
  });

  it('rejects with 429 once the limit is reached within the window', async () => {
    signInAttemptModel.findOne.mockReturnValue(
      withLean({ failedCount: MAX_FAILED_SIGN_IN_ATTEMPTS, expiresAt: FUTURE }),
    );

    await expect(service.assertNotLocked(EMAIL)).rejects.toThrow(HttpException);
    await expect(service.assertNotLocked(EMAIL)).rejects.toThrow('Too many failed sign-in attempts, try again later');
  });

  it('treats a logically expired record as absent even before TTL purges it', async () => {
    signInAttemptModel.findOne.mockReturnValue(withLean({ failedCount: MAX_FAILED_SIGN_IN_ATTEMPTS, expiresAt: PAST }));

    await expect(service.assertNotLocked(EMAIL)).resolves.toBeUndefined();
  });

  it('records a failure by incrementing atomically and sliding the window forward', async () => {
    await service.recordFailure(EMAIL);

    const [filter, update, options] = signInAttemptModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ email: EMAIL });
    expect(update.$inc).toEqual({ failedCount: 1 });
    expect(update.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(options).toMatchObject({ upsert: true });
    // Stale (expired but unpurged) counters are dropped first so they cannot leak into a new window.
    expect(signInAttemptModel.deleteOne.mock.calls[0][0]).toMatchObject({ email: EMAIL });
  });

  it('records a security event exactly when the failure that locks the email lands', async () => {
    signInAttemptModel.findOneAndUpdate.mockResolvedValue({ failedCount: MAX_FAILED_SIGN_IN_ATTEMPTS });

    await service.recordFailure(EMAIL);

    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.SignInLocked, { email: EMAIL });
  });

  it('resets the counter after a successful sign-in', async () => {
    await service.reset(EMAIL);

    expect(signInAttemptModel.deleteOne).toHaveBeenCalledWith({ email: EMAIL });
  });
});
