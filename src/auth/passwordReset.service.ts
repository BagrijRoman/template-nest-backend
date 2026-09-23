import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '../common/errors/index.js';
import { MailService } from '../common/mail/mail.service.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { CredentialsService } from '../users/credentials.service.js';
import { UsersService } from '../users/users.service.js';
import { AccountRateLimitService } from './accountRateLimit.service.js';
import { ActionTokensService } from './actionTokens.service.js';
import { EMAIL_ACTION_LIMIT, EMAIL_ACTION_WINDOW_MS, PASSWORD_RESET_TOKEN_TTL_MS } from './auth.constants.js';
import { ActionTokenType } from './entities/index.js';
import { RefreshTokensService } from './refreshTokens.service.js';

const PASSWORD_RESET_EMAIL_ACTION = 'password-reset-email';
const INVALID_TOKEN_MESSAGE = 'Invalid or expired reset token';

const invalidTokenException = (): AppException =>
  AppException.forField(
    HttpStatus.BAD_REQUEST,
    ErrorCode.InvalidResetToken,
    'token',
    'validToken',
    INVALID_TOKEN_MESSAGE,
  );

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly actionTokensService: ActionTokensService,
    private readonly usersService: UsersService,
    private readonly credentialsService: CredentialsService,
    private readonly refreshTokensService: RefreshTokensService,
    private readonly mailService: MailService,
    private readonly securityEvents: SecurityEventsService,
    private readonly accountRateLimit: AccountRateLimitService,
  ) {}

  /**
   * Silently does nothing for unknown emails — the endpoint answers 204 either way, so neither
   * the response nor its side effects reveal whether an account exists. Issuing invalidates any
   * previous reset token: exactly one is redeemable at a time.
   */
  async requestReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return;
    }

    // Over the cap the endpoint still answers 204 (a 429 would reveal the account exists) but
    // sends nothing more; the owner got a security alert when the cap tripped.
    const isAllowed = await this.accountRateLimit.consume(
      PASSWORD_RESET_EMAIL_ACTION,
      user,
      EMAIL_ACTION_LIMIT,
      EMAIL_ACTION_WINDOW_MS,
    );
    if (!isAllowed) {
      return;
    }

    const token = await this.actionTokensService.issue(
      ActionTokenType.PasswordReset,
      user.id,
      PASSWORD_RESET_TOKEN_TTL_MS,
    );

    this.securityEvents.record(SecurityEvent.PasswordResetRequested, { userId: user.id });
    await this.mailService.send({
      to: user.email,
      subject: 'Reset your password',
      text:
        `Use this token to reset your password: ${token}\n` +
        `It is valid for ${PASSWORD_RESET_TOKEN_TTL_MS / 60_000} minutes and works exactly once. ` +
        'If you did not request a reset, you can ignore this email — your password is unchanged.',
    });
  }

  /**
   * Redeems the token atomically (find-and-delete — a token works exactly once), replaces the
   * password and revokes every session: whoever held the old password or a stolen refresh token
   * is signed out everywhere. Expired, already-used and forged tokens get the same generic 400.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const userId = await this.actionTokensService.redeem(ActionTokenType.PasswordReset, token);
    if (!userId) {
      throw invalidTokenException();
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      // The account vanished after the token was issued; the token is already consumed.
      throw invalidTokenException();
    }
    await this.credentialsService.replacePassword(user.id, newPassword);

    // Both halves of "sign out everywhere": stored refresh tokens die, and access tokens issued
    // before now stop authenticating.
    await Promise.all([
      this.refreshTokensService.revokeAllForUser(user.id),
      this.usersService.markSessionsRevoked(user.id),
    ]);
    this.securityEvents.record(SecurityEvent.PasswordResetCompleted, { userId: user.id });
    await this.mailService.send({
      to: user.email,
      subject: 'Your password was changed',
      text:
        'Your password was just changed via the reset flow and every session was signed out. ' +
        'If this was not you, request a new password reset immediately.',
    });
  }
}
