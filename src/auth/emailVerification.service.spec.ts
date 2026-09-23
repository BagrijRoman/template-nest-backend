import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../common/errors/index.js';
import { MailService } from '../common/mail/mail.service.js';
import { AccountRateLimitService } from './accountRateLimit.service.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { UserRole, type UserProfile } from '../users/entities/index.js';
import { UsersService } from '../users/users.service.js';
import { ActionTokensService } from './actionTokens.service.js';
import { ActionTokenType } from './entities/index.js';
import { EmailVerificationService } from './emailVerification.service.js';

const USER: UserProfile = {
  id: '507f1f77bcf86cd799439011',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  emailVerified: false,
  role: UserRole.User,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const VERIFICATION_TOKEN = 'b'.repeat(64);

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;

  const actionTokensService = { issue: vi.fn(), redeem: vi.fn() };
  const usersService = { findByEmail: vi.fn(), findById: vi.fn(), markEmailVerified: vi.fn() };
  const mailService = { send: vi.fn() };
  const securityEvents = { record: vi.fn() };
  const accountRateLimit = { consume: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    actionTokensService.issue.mockResolvedValue(VERIFICATION_TOKEN);
    accountRateLimit.consume.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        { provide: ActionTokensService, useValue: actionTokensService },
        { provide: UsersService, useValue: usersService },
        { provide: MailService, useValue: mailService },
        { provide: SecurityEventsService, useValue: securityEvents },
        { provide: AccountRateLimitService, useValue: accountRateLimit },
      ],
    }).compile();

    service = module.get<EmailVerificationService>(EmailVerificationService);
  });

  it('issues a verification token for this account and emails exactly that token', async () => {
    await service.sendVerification(USER);

    const [type, userId, ttlMs] = actionTokensService.issue.mock.calls[0];
    expect(type).toBe(ActionTokenType.EmailVerification);
    expect(userId).toBe(USER.id);
    expect(ttlMs).toBeGreaterThan(0);
    expect(mailService.send.mock.calls[0][0].text).toContain(VERIFICATION_TOKEN);
    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.EmailVerificationSent, { userId: USER.id });
  });

  it('verifies: consumes the token by hash and marks the account verified', async () => {
    actionTokensService.redeem.mockResolvedValue(USER.id);
    usersService.markEmailVerified.mockResolvedValue({ ...USER, emailVerified: true });

    await service.verify('raw-token');

    expect(actionTokensService.redeem).toHaveBeenCalledWith(ActionTokenType.EmailVerification, 'raw-token');
    expect(usersService.markEmailVerified).toHaveBeenCalledWith(USER.id);
    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.EmailVerified, { userId: USER.id });
  });

  it('rejects every token the store refuses with the same generic 400', async () => {
    actionTokensService.redeem.mockResolvedValue(null);
    await expect(service.verify('forged')).rejects.toMatchObject({
      code: ErrorCode.InvalidVerificationToken,
      message: 'Invalid or expired verification token',
      details: [{ field: 'token' }],
    });

    await expect(service.verify('stale')).rejects.toMatchObject({
      code: ErrorCode.InvalidVerificationToken,
      message: 'Invalid or expired verification token',
      details: [{ field: 'token' }],
    });
    expect(usersService.markEmailVerified).not.toHaveBeenCalled();
  });

  it('sends for an authenticated unverified caller identified by id', async () => {
    usersService.findById.mockResolvedValue(USER);

    await service.requestVerification(USER.id);

    expect(mailService.send).toHaveBeenCalledTimes(1);
  });

  it('answers the authenticated caller honestly: 400 when already verified, 429 when over the cap', async () => {
    usersService.findById.mockResolvedValue({ ...USER, emailVerified: true });
    await expect(service.requestVerification(USER.id)).rejects.toThrow('Email is already verified');

    usersService.findById.mockResolvedValue(USER);
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
    expect(actionTokensService.issue).not.toHaveBeenCalled();
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
    expect(actionTokensService.issue).not.toHaveBeenCalled();
  });
});
