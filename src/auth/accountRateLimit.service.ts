import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, trusted } from 'mongoose';
import { MailService } from '../common/mail/mail.service.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import type { SafeUser } from '../users/entities/index.js';
import { AccountActionCounter } from './entities/index.js';

const MS_PER_MINUTE = 60_000;

/**
 * Per-account complement to the per-IP throttler for expensive or abuse-prone actions (today:
 * email-sending flows). One fixed window per action+account; exceeding the limit blocks the
 * action until the window expires. The first request over the limit — and only that one —
 * raises a warn-level security event and a security-alert email to the account owner.
 */
@Injectable()
export class AccountRateLimitService {
  constructor(
    @InjectModel(AccountActionCounter.name)
    private readonly accountActionCounterModel: Model<AccountActionCounter>,
    private readonly mailService: MailService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  /**
   * Counts one request and reports whether the action is still allowed. The caller decides how
   * a refusal surfaces: authenticated endpoints answer an honest 429, public ones stay silent —
   * a 429 there would reveal that the email belongs to an account.
   */
  async consume(action: string, user: SafeUser, limit: number, windowMs: number): Promise<boolean> {
    const key = `${action}:${user.id}`;

    // A logically expired counter must not leak stale counts while it awaits TTL purging.
    // trusted(): the $-operator is server-built, not user input (see the sanitizeFilter rule).
    await this.accountActionCounterModel.deleteOne({ key, expiresAt: trusted({ $lte: new Date() }) });

    const counter = await this.accountActionCounterModel.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + windowMs) } },
      { upsert: true, new: true },
    );

    if (counter.count === limit + 1) {
      this.securityEvents.record(SecurityEvent.AccountRateLimitExceeded, { userId: user.id, action });
      await this.mailService.send({
        to: user.email,
        subject: 'Security alert: unusual activity on your account',
        text:
          `We received an unusual number of "${action}" requests for your account, ` +
          `so this action is temporarily blocked for up to ${Math.ceil(windowMs / MS_PER_MINUTE)} minutes. ` +
          'If this was not you, we recommend changing your password.',
      });
    }

    return counter.count <= limit;
  }
}
