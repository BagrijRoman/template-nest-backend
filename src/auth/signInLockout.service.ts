import { Injectable } from '@nestjs/common';
import { ErrorCode, rateLimitedException } from '../common/errors/index.js';
import { InjectModel } from '@nestjs/mongoose';
import { Model, trusted } from 'mongoose';
import { MailService } from '../common/mail/mail.service.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { UsersService } from '../users/users.service.js';
import { MAX_FAILED_SIGN_IN_ATTEMPTS, SIGN_IN_LOCKOUT_WINDOW_MS } from './auth.constants.js';
import { SignInAttempt } from './entities/index.js';

const LOCKED_MESSAGE = 'Too many failed sign-in attempts, try again later';
const MS_PER_SECOND = 1000;

/**
 * Per-account complement to the per-IP throttler: IP limits alone do not stop a distributed
 * password-guessing attack against one account. Counters are kept per email — for unknown
 * emails too, so lockout behavior cannot be used to probe whether an account exists.
 */
@Injectable()
export class SignInLockoutService {
  constructor(
    @InjectModel(SignInAttempt.name) private readonly signInAttemptModel: Model<SignInAttempt>,
    private readonly securityEvents: SecurityEventsService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
  ) {}

  /** Rejects with 429 while the email is locked; the window slides with every failed attempt. */
  async assertNotLocked(email: string): Promise<void> {
    const attempt = await this.signInAttemptModel.findOne({ email }).lean();
    const isLocked =
      attempt !== null && attempt.failedCount >= MAX_FAILED_SIGN_IN_ATTEMPTS && attempt.expiresAt > new Date();
    if (isLocked) {
      const retryAfterSeconds = Math.ceil((attempt.expiresAt.getTime() - Date.now()) / MS_PER_SECOND);
      throw rateLimitedException(ErrorCode.AccountLocked, LOCKED_MESSAGE, retryAfterSeconds);
    }
  }

  async recordFailure(email: string): Promise<void> {
    // A logically expired record must not contribute stale counts while it awaits TTL purging.
    // trusted(): this $-operator is server-built, not user input — the global sanitizeFilter
    // would otherwise neutralize it into an $eq and make the query throw a CastError.
    await this.signInAttemptModel.deleteOne({ email, expiresAt: trusted({ $lte: new Date() }) });

    const attempt = await this.signInAttemptModel.findOneAndUpdate(
      { email },
      { $inc: { failedCount: 1 }, expiresAt: new Date(Date.now() + SIGN_IN_LOCKOUT_WINDOW_MS) },
      { upsert: true, new: true },
    );
    if (attempt.failedCount === MAX_FAILED_SIGN_IN_ATTEMPTS) {
      this.securityEvents.record(SecurityEvent.SignInLocked, { email });
      await this.notifyAccountOwner(email);
    }
  }

  /**
   * Counters cover unknown emails (anti-enumeration), but the warning email goes only to accounts
   * that exist — mailing every probed address would spam strangers on an attacker's word.
   */
  private async notifyAccountOwner(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return;
    }
    await this.mailService.send({
      to: user.email,
      subject: 'Suspicious sign-in activity on your account',
      text:
        `Sign-in to your account was temporarily locked after ${MAX_FAILED_SIGN_IN_ATTEMPTS} failed password attempts. ` +
        'If this was not you, we recommend changing your password once the lock expires.',
    });
  }

  /** A successful sign-in proves the caller owns the password — the slate is wiped. */
  async reset(email: string): Promise<void> {
    await this.signInAttemptModel.deleteOne({ email });
  }
}
