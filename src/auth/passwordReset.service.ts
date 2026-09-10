import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MailService } from '../common/mail/mail.service.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { UsersService } from '../users/users.service.js';
import { AccountRateLimitService } from './accountRateLimit.service.js';
import { EMAIL_ACTION_LIMIT, EMAIL_ACTION_WINDOW_MS, PASSWORD_RESET_TOKEN_TTL_MS } from './auth.constants.js';
import { PasswordResetToken } from './entities/index.js';
import { RefreshTokensService } from './refreshTokens.service.js';

const RESET_TOKEN_BYTES = 32;
const PASSWORD_RESET_EMAIL_ACTION = 'password-reset-email';
const INVALID_TOKEN_MESSAGE = 'Invalid or expired reset token';

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class PasswordResetService {
  constructor(
    @InjectModel(PasswordResetToken.name) private readonly passwordResetTokenModel: Model<PasswordResetToken>,
    private readonly usersService: UsersService,
    private readonly refreshTokensService: RefreshTokensService,
    private readonly mailService: MailService,
    private readonly securityEvents: SecurityEventsService,
    private readonly accountRateLimit: AccountRateLimitService,
  ) {}

  /**
   * Silently does nothing for unknown emails — the endpoint answers 204 either way, so neither
   * the response nor its side effects reveal whether an account exists. A new request invalidates
   * any previous token: exactly one reset token per user is redeemable at a time.
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

    await this.passwordResetTokenModel.deleteMany({ userId: user.id });

    const token = randomBytes(RESET_TOKEN_BYTES).toString('hex');
    await this.passwordResetTokenModel.create({
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
    });

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
    const record = await this.passwordResetTokenModel.findOneAndDelete({ tokenHash: hashToken(token) }).lean();
    if (!record || record.expiresAt <= new Date()) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    const user = await this.usersService.replacePassword(record.userId, newPassword);
    if (!user) {
      // The account vanished after the token was issued; the token is already consumed.
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    await this.refreshTokensService.revokeAllForUser(user.id);
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
