import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException, ErrorCode, rateLimitedException, unauthenticatedException } from '../common/errors/index.js';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MailService } from '../common/mail/mail.service.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import type { UserProfile } from '../users/entities/index.js';
import { UsersService } from '../users/users.service.js';
import { AccountRateLimitService } from './accountRateLimit.service.js';
import { EMAIL_ACTION_LIMIT, EMAIL_ACTION_WINDOW_MS, EMAIL_VERIFICATION_TOKEN_TTL_MS } from './auth.constants.js';
import { EmailVerificationToken } from './entities/index.js';

const VERIFICATION_TOKEN_BYTES = 32;
const VERIFICATION_EMAIL_ACTION = 'verification-email';
const INVALID_TOKEN_MESSAGE = 'Invalid or expired verification token';
const MS_PER_SECOND = 1000;

const invalidTokenException = (): AppException =>
  AppException.forField(
    HttpStatus.BAD_REQUEST,
    ErrorCode.InvalidVerificationToken,
    'token',
    'validToken',
    INVALID_TOKEN_MESSAGE,
  );
const MS_PER_HOUR = 3_600_000;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class EmailVerificationService {
  constructor(
    @InjectModel(EmailVerificationToken.name)
    private readonly emailVerificationTokenModel: Model<EmailVerificationToken>,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly securityEvents: SecurityEventsService,
    private readonly accountRateLimit: AccountRateLimitService,
  ) {}

  /**
   * The authenticated variant: the caller is identified by their access token, not by an email
   * in the body. Being about the caller's own account, it can be honest — 400 when already
   * verified, 429 when the per-account cap is exceeded.
   */
  async requestVerification(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw unauthenticatedException();
    }
    if (user.emailVerified) {
      throw new AppException(HttpStatus.BAD_REQUEST, ErrorCode.EmailAlreadyVerified, 'Email is already verified');
    }

    const isAllowed = await this.accountRateLimit.consume(
      VERIFICATION_EMAIL_ACTION,
      user,
      EMAIL_ACTION_LIMIT,
      EMAIL_ACTION_WINDOW_MS,
    );
    if (!isAllowed) {
      throw rateLimitedException(
        ErrorCode.RateLimited,
        'Too many verification emails requested, try again later',
        EMAIL_ACTION_WINDOW_MS / MS_PER_SECOND,
      );
    }

    await this.sendVerification(user);
  }

  /** Issues a fresh verification token (invalidating any previous one) and emails it. */
  async sendVerification(user: UserProfile): Promise<void> {
    await this.emailVerificationTokenModel.deleteMany({ userId: user.id });

    const token = randomBytes(VERIFICATION_TOKEN_BYTES).toString('hex');
    await this.emailVerificationTokenModel.create({
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
    });

    this.securityEvents.record(SecurityEvent.EmailVerificationSent, { userId: user.id });
    await this.mailService.send({
      to: user.email,
      subject: 'Verify your email address',
      text:
        `Use this token to verify your email address: ${token}\n` +
        `It is valid for ${EMAIL_VERIFICATION_TOKEN_TTL_MS / MS_PER_HOUR} hours and works exactly once.`,
    });
  }

  /**
   * Redeems the token atomically (find-and-delete — exactly one use) and marks the account
   * verified. Expired, already-used and forged tokens get the same generic 400.
   */
  async verify(token: string): Promise<void> {
    const record = await this.emailVerificationTokenModel.findOneAndDelete({ tokenHash: hashToken(token) }).lean();
    if (!record || record.expiresAt <= new Date()) {
      throw invalidTokenException();
    }

    const user = await this.usersService.markEmailVerified(record.userId);
    if (!user) {
      throw invalidTokenException();
    }

    this.securityEvents.record(SecurityEvent.EmailVerified, { userId: user.id });
  }

  /**
   * Always silent to the caller (the endpoint answers 204 either way): an unknown email and an
   * already-verified account both do nothing, so the endpoint reveals no account state.
   */
  async resend(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user || user.emailVerified) {
      return;
    }
    // Over the cap the endpoint still answers 204 (a 429 would reveal the account exists) but
    // sends nothing more; the owner got a security alert when the cap tripped.
    const isAllowed = await this.accountRateLimit.consume(
      VERIFICATION_EMAIL_ACTION,
      user,
      EMAIL_ACTION_LIMIT,
      EMAIL_ACTION_WINDOW_MS,
    );
    if (!isAllowed) {
      return;
    }
    await this.sendVerification(user);
  }
}
