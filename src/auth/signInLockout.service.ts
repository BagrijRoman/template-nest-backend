import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, trusted } from 'mongoose';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { MAX_FAILED_SIGN_IN_ATTEMPTS, SIGN_IN_LOCKOUT_WINDOW_MS } from './auth.constants.js';
import { SignInAttempt } from './entities/index.js';

const LOCKED_MESSAGE = 'Too many failed sign-in attempts, try again later';

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
  ) {}

  /** Rejects with 429 while the email is locked; the window slides with every failed attempt. */
  async assertNotLocked(email: string): Promise<void> {
    const attempt = await this.signInAttemptModel.findOne({ email }).lean();
    const isLocked =
      attempt !== null && attempt.failedCount >= MAX_FAILED_SIGN_IN_ATTEMPTS && attempt.expiresAt > new Date();
    if (isLocked) {
      throw new HttpException(LOCKED_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
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
    }
  }

  /** A successful sign-in proves the caller owns the password — the slate is wiped. */
  async reset(email: string): Promise<void> {
    await this.signInAttemptModel.deleteOne({ email });
  }
}
