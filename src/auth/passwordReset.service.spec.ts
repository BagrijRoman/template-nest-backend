import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../common/errors/index.js';
import { MailService } from '../common/mail/mail.service.js';
import { AccountRateLimitService } from './accountRateLimit.service.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { CredentialsService } from '../users/credentials.service.js';
import { UsersService } from '../users/users.service.js';
import { ActionTokensService } from './actionTokens.service.js';
import { ActionTokenType } from './entities/index.js';
import { PasswordResetService } from './passwordReset.service.js';
import { RefreshTokensService } from './refreshTokens.service.js';

const USER = { id: '507f1f77bcf86cd799439011', email: 'jane@example.com' };
const RESET_TOKEN = 'a'.repeat(64);

describe('PasswordResetService', () => {
  let service: PasswordResetService;

  const actionTokensService = { issue: vi.fn(), redeem: vi.fn() };
  const usersService = { findByEmail: vi.fn(), findById: vi.fn(), markSessionsRevoked: vi.fn() };
  const credentialsService = { replacePassword: vi.fn() };
  const refreshTokensService = { revokeAllForUser: vi.fn() };
  const mailService = { send: vi.fn() };
  const securityEvents = { record: vi.fn() };
  const accountRateLimit = { consume: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    actionTokensService.issue.mockResolvedValue(RESET_TOKEN);
    accountRateLimit.consume.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: ActionTokensService, useValue: actionTokensService },
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

    expect(actionTokensService.issue).not.toHaveBeenCalled();
    expect(mailService.send).not.toHaveBeenCalled();
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  it('stays a silent no-op over the per-account cap — no token, no mail', async () => {
    usersService.findByEmail.mockResolvedValue(USER);
    accountRateLimit.consume.mockResolvedValue(false);

    await service.requestReset(USER.email);

    expect(actionTokensService.issue).not.toHaveBeenCalled();
    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('issues a reset token for this account and emails exactly that token', async () => {
    usersService.findByEmail.mockResolvedValue(USER);

    await service.requestReset(USER.email);

    const [type, userId, ttlMs] = actionTokensService.issue.mock.calls[0];
    expect(type).toBe(ActionTokenType.PasswordReset);
    expect(userId).toBe(USER.id);
    expect(ttlMs).toBeGreaterThan(0);
    expect(mailService.send.mock.calls[0][0].text).toContain(RESET_TOKEN);
    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.PasswordResetRequested, { userId: USER.id });
  });

  it('resets: consumes the token by hash, replaces the password, revokes every session, notifies', async () => {
    actionTokensService.redeem.mockResolvedValue(USER.id);
    usersService.findById.mockResolvedValue(USER);

    await service.resetPassword('raw-token', 'NewSecret123');

    expect(actionTokensService.redeem).toHaveBeenCalledWith(ActionTokenType.PasswordReset, 'raw-token');
    expect(credentialsService.replacePassword).toHaveBeenCalledWith(USER.id, 'NewSecret123');
    expect(refreshTokensService.revokeAllForUser).toHaveBeenCalledWith(USER.id);
    // The other half of "sign out everywhere": access tokens issued earlier stop authenticating.
    expect(usersService.markSessionsRevoked).toHaveBeenCalledWith(USER.id);
    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.PasswordResetCompleted, { userId: USER.id });
    expect(mailService.send).toHaveBeenCalledWith(expect.objectContaining({ to: USER.email }));
  });

  it('rejects a token the store refuses — unknown, expired, used or issued for another action', async () => {
    actionTokensService.redeem.mockResolvedValue(null);

    await expect(service.resetPassword('forged', 'NewSecret123')).rejects.toMatchObject({
      code: ErrorCode.InvalidResetToken,
      message: 'Invalid or expired reset token',
      details: [{ field: 'token' }],
    });
    expect(credentialsService.replacePassword).not.toHaveBeenCalled();
    expect(refreshTokensService.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('rejects a token whose account vanished, without touching credentials', async () => {
    actionTokensService.redeem.mockResolvedValue(USER.id);
    usersService.findById.mockResolvedValue(null);

    await expect(service.resetPassword('orphaned', 'NewSecret123')).rejects.toMatchObject({
      code: ErrorCode.InvalidResetToken,
    });
    expect(credentialsService.replacePassword).not.toHaveBeenCalled();
  });
});
