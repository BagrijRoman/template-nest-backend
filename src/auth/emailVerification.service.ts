import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MailService } from '../common/mail/mail.service.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import type { SafeUser } from '../users/entities/index.js';
import { UsersService } from '../users/users.service.js';
import { EMAIL_VERIFICATION_TOKEN_TTL_MS } from './auth.constants.js';
import { EmailVerificationToken } from './entities/index.js';

const VERIFICATION_TOKEN_BYTES = 32;
const INVALID_TOKEN_MESSAGE = 'Invalid or expired verification token';
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
  ) {}

  /** Issues a fresh verification token (invalidating any previous one) and emails it. */
  async sendVerification(user: SafeUser): Promise<void> {
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
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    const user = await this.usersService.markEmailVerified(record.userId);
    if (!user) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
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
    await this.sendVerification(user);
  }
}
