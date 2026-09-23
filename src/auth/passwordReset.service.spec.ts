import { createHash } from 'node:crypto';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../common/errors/index.js';
import { MailService } from '../common/mail/mail.service.js';
import { AccountRateLimitService } from './accountRateLimit.service.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { CredentialsService } from '../users/credentials.service.js';
import { UsersService } from '../users/users.service.js';
import { PasswordResetToken } from './entities/index.js';
import { PasswordResetService } from './passwordReset.service.js';
import { RefreshTokensService } from './refreshTokens.service.js';

const USER = { id: '507f1f77bcf86cd799439011', email: 'jane@example.com' };
const FUTURE = new Date(Date.now() + 60_000);
const PAST = new Date(Date.now() - 60_000);

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const withLean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });

describe('PasswordResetService', () => {
  let service: PasswordResetService;

  const passwordResetTokenModel = {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findOneAndDelete: vi.fn(),
  };
  const usersService = { findByEmail: vi.fn(), findById: vi.fn() };
  const credentialsService = { replacePassword: vi.fn() };
  const refreshTokensService = { revokeAllForUser: vi.fn() };
  const mailService = { send: vi.fn() };
  const securityEvents = { record: vi.fn() };
  const accountRateLimit = { consume: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    passwordResetTokenModel.deleteMany.mockResolvedValue({ deletedCount: 0 });
    accountRateLimit.consume.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: getModelToken(PasswordResetToken.name), useValue: passwordResetTokenModel },
        { provide: UsersService, useValue: usersService },
        { provide: CredentialsService, useValue: credentialsService },
        { provide: RefreshTokensService, useValue: refreshTokensService },
        { provide: MailService, useValue: mailService },
        { provide: SecurityEventsService, useValue: securityEvents },
        { provide: AccountRateLimitService, useValue: accountRateLimit },
      ],
    }).compile();

    service = module.get<PasswordResetService>(PasswordResetService);
  });

  it('stays completely silent for an unknown email — no token, no mail, no event', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await service.requestReset('missing@example.com');

    expect(passwordResetTokenModel.create).not.toHaveBeenCalled();
    expect(mailService.send).not.toHaveBeenCalled();
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  it('stays a silent no-op over the per-account cap — no token, no mail', async () => {
    usersService.findByEmail.mockResolvedValue(USER);
    accountRateLimit.consume.mockResolvedValue(false);

    await service.requestReset(USER.email);

    expect(passwordResetTokenModel.create).not.toHaveBeenCalled();
    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('stores only the hash of the token it emails, invalidating any previous token first', async () => {
    usersService.findByEmail.mockResolvedValue(USER);

    await service.requestReset(USER.email);

    expect(passwordResetTokenModel.deleteMany).toHaveBeenCalledWith({ userId: USER.id });
    const stored = passwordResetTokenModel.create.mock.calls[0][0];
    const mailedText: string = mailService.send.mock.calls[0][0].text;
    const mailedToken = mailedText.match(/[0-9a-f]{64}/)?.[0];
    expect(mailedToken).toBeDefined();
    expect(stored.tokenHash).toBe(sha256(mailedToken ?? ''));
    expect(stored.userId).toBe(USER.id);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.PasswordResetRequested, { userId: USER.id });
  });

  it('resets: consumes the token by hash, replaces the password, revokes every session, notifies', async () => {
    passwordResetTokenModel.findOneAndDelete.mockReturnValue(withLean({ userId: USER.id, expiresAt: FUTURE }));
    usersService.findById.mockResolvedValue(USER);

    await service.resetPassword('raw-token', 'NewSecret123');

    expect(passwordResetTokenModel.findOneAndDelete).toHaveBeenCalledWith({ tokenHash: sha256('raw-token') });
    expect(credentialsService.replacePassword).toHaveBeenCalledWith(USER.id, 'NewSecret123');
    expect(refreshTokensService.revokeAllForUser).toHaveBeenCalledWith(USER.id);
    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.PasswordResetCompleted, { userId: USER.id });
    expect(mailService.send).toHaveBeenCalledWith(expect.objectContaining({ to: USER.email }));
  });

  it('rejects an unknown token with a generic 400 and changes nothing', async () => {
    passwordResetTokenModel.findOneAndDelete.mockReturnValue(withLean(null));

    await expect(service.resetPassword('forged', 'NewSecret123')).rejects.toMatchObject({
      code: ErrorCode.InvalidResetToken,
      message: 'Invalid or expired reset token',
      details: [{ field: 'token' }],
    });
    expect(credentialsService.replacePassword).not.toHaveBeenCalled();
    expect(refreshTokensService.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('rejects a token whose account vanished, without touching credentials', async () => {
    passwordResetTokenModel.findOneAndDelete.mockReturnValue(withLean({ userId: USER.id, expiresAt: FUTURE }));
    usersService.findById.mockResolvedValue(null);

    await expect(service.resetPassword('orphaned', 'NewSecret123')).rejects.toMatchObject({
      code: ErrorCode.InvalidResetToken,
    });
    expect(credentialsService.replacePassword).not.toHaveBeenCalled();
  });

  it('rejects a logically expired token even before TTL purges it, with the same 400', async () => {
    passwordResetTokenModel.findOneAndDelete.mockReturnValue(withLean({ userId: USER.id, expiresAt: PAST }));

    await expect(service.resetPassword('stale', 'NewSecret123')).rejects.toMatchObject({
      code: ErrorCode.InvalidResetToken,
      message: 'Invalid or expired reset token',
      details: [{ field: 'token' }],
    });
    expect(credentialsService.replacePassword).not.toHaveBeenCalled();
  });
});
