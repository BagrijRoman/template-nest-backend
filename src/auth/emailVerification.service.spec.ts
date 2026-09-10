import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MailService } from '../common/mail/mail.service.js';
import { AccountRateLimitService } from './accountRateLimit.service.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { UsersService } from '../users/users.service.js';
import { EmailVerificationToken } from './entities/index.js';
import { EmailVerificationService } from './emailVerification.service.js';

const USER = { id: '507f1f77bcf86cd799439011', email: 'jane@example.com', emailVerified: false };
const FUTURE = new Date(Date.now() + 60_000);

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const withLean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;

  const emailVerificationTokenModel = {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findOneAndDelete: vi.fn(),
  };
  const usersService = { findByEmail: vi.fn(), markEmailVerified: vi.fn() };
  const mailService = { send: vi.fn() };
  const securityEvents = { record: vi.fn() };
  const accountRateLimit = { consume: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    emailVerificationTokenModel.deleteMany.mockResolvedValue({ deletedCount: 0 });
    accountRateLimit.consume.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        { provide: getModelToken(EmailVerificationToken.name), useValue: emailVerificationTokenModel },
        { provide: UsersService, useValue: usersService },
        { provide: MailService, useValue: mailService },
        { provide: SecurityEventsService, useValue: securityEvents },
        { provide: AccountRateLimitService, useValue: accountRateLimit },
      ],
    }).compile();

    service = module.get<EmailVerificationService>(EmailVerificationService);
  });

  it('stores only the hash of the token it emails, invalidating any previous token first', async () => {
    await service.sendVerification(USER);

    expect(emailVerificationTokenModel.deleteMany).toHaveBeenCalledWith({ userId: USER.id });
    const stored = emailVerificationTokenModel.create.mock.calls[0][0];
    const mailedToken = mailService.send.mock.calls[0][0].text.match(/[0-9a-f]{64}/)?.[0];
    expect(mailedToken).toBeDefined();
    expect(stored.tokenHash).toBe(sha256(mailedToken ?? ''));
    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.EmailVerificationSent, { userId: USER.id });
  });

  it('verifies: consumes the token by hash and marks the account verified', async () => {
    emailVerificationTokenModel.findOneAndDelete.mockReturnValue(withLean({ userId: USER.id, expiresAt: FUTURE }));
    usersService.markEmailVerified.mockResolvedValue({ ...USER, emailVerified: true });

    await service.verify('raw-token');

    expect(emailVerificationTokenModel.findOneAndDelete).toHaveBeenCalledWith({ tokenHash: sha256('raw-token') });
    expect(usersService.markEmailVerified).toHaveBeenCalledWith(USER.id);
    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.EmailVerified, { userId: USER.id });
  });

  it('rejects unknown and expired tokens with the same generic 400', async () => {
    emailVerificationTokenModel.findOneAndDelete.mockReturnValue(withLean(null));
    await expect(service.verify('forged')).rejects.toThrow(
      new BadRequestException('Invalid or expired verification token'),
    );

    emailVerificationTokenModel.findOneAndDelete.mockReturnValue(
      withLean({ userId: USER.id, expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(service.verify('stale')).rejects.toThrow(
      new BadRequestException('Invalid or expired verification token'),
    );
    expect(usersService.markEmailVerified).not.toHaveBeenCalled();
  });

  it('sends for an authenticated unverified caller identified by id', async () => {
    usersService.findById = vi.fn().mockResolvedValue(USER);

    await service.requestVerification(USER.id);

    expect(mailService.send).toHaveBeenCalledTimes(1);
  });

  it('answers the authenticated caller honestly: 400 when already verified, 429 when over the cap', async () => {
    usersService.findById = vi.fn().mockResolvedValue({ ...USER, emailVerified: true });
    await expect(service.requestVerification(USER.id)).rejects.toThrow('Email is already verified');

    usersService.findById = vi.fn().mockResolvedValue(USER);
    accountRateLimit.consume.mockResolvedValue(false);
    await expect(service.requestVerification(USER.id)).rejects.toThrow(
      'Too many verification emails requested, try again later',
    );
    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('public resend stays a silent 204 over the cap — no mail, no error', async () => {
    usersService.findByEmail.mockResolvedValue(USER);
    accountRateLimit.consume.mockResolvedValue(false);

    await service.resend(USER.email);

    expect(mailService.send).not.toHaveBeenCalled();
    expect(emailVerificationTokenModel.create).not.toHaveBeenCalled();
  });

  it('resends silently for an unverified account only', async () => {
    usersService.findByEmail.mockResolvedValue(USER);

    await service.resend(USER.email);

    expect(mailService.send).toHaveBeenCalledTimes(1);
  });

  it('stays silent for unknown emails and already-verified accounts alike', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    await service.resend('missing@example.com');

    usersService.findByEmail.mockResolvedValue({ ...USER, emailVerified: true });
    await service.resend(USER.email);

    expect(mailService.send).not.toHaveBeenCalled();
    expect(emailVerificationTokenModel.create).not.toHaveBeenCalled();
  });
});
