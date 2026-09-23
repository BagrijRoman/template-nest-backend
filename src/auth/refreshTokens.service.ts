import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MailService } from '../common/mail/mail.service.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { UsersService } from '../users/users.service.js';
import { RefreshToken } from './entities/index.js';
import { SessionsService } from './sessions.service.js';
import { TokensService } from './tokens.service.js';

const MS_PER_SECOND = 1000;

// Deterministic sha256, not scrypt: a refresh token embeds a 256-bit HMAC signature, so preimage
// resistance is enough — and the store is looked up by hash, which requires determinism.
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export type ConsumedRefreshToken = { userId: string; sessionId: string };

@Injectable()
export class RefreshTokensService {
  constructor(
    @InjectModel(RefreshToken.name) private readonly refreshTokenModel: Model<RefreshToken>,
    private readonly tokensService: TokensService,
    private readonly securityEvents: SecurityEventsService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly sessionsService: SessionsService,
  ) {}

  /**
   * Stores a just-issued refresh token, hashed, inside the given session; the record expires with the
   * token, and its expiry is returned so the session can be kept alive exactly as long.
   */
  async persist(refreshToken: string, sessionId: string): Promise<Date> {
    const payload = await this.tokensService.verifyRefreshToken(refreshToken);
    if (!payload) {
      // Only just-issued tokens reach here, so an invalid one is a programming error, not user input.
      throw new Error('Refusing to persist an invalid refresh token');
    }

    const expiresAt = new Date(payload.exp * MS_PER_SECOND);
    await this.refreshTokenModel.create({
      tokenHash: hashToken(refreshToken),
      userId: payload.sub,
      sessionId,
      consumedAt: null,
      expiresAt,
    });
    return expiresAt;
  }

  /**
   * Redeems a refresh token: verifies it and atomically marks its record consumed, so a token can
   * never be redeemed twice — rotation and logout share this. Returns the owner and session, or
   * null when the token is invalid, expired, already used, or revoked.
   *
   * A consumed token showing up again is proof of theft (either the thief or the victim holds a
   * copy that already rotated), so the whole session is revoked — the strict stance: a legitimate
   * double-refresh race also ends the session rather than leaving a stolen token alive.
   */
  async consume(refreshToken: string): Promise<ConsumedRefreshToken | null> {
    const payload = await this.tokensService.verifyRefreshToken(refreshToken);
    if (!payload) {
      return null;
    }

    const tokenHash = hashToken(refreshToken);
    const record = await this.refreshTokenModel
      .findOneAndUpdate({ tokenHash, consumedAt: null }, { consumedAt: new Date() })
      .lean();
    if (record) {
      return { userId: record.userId, sessionId: record.sessionId };
    }

    const reusedRecord = await this.refreshTokenModel.findOne({ tokenHash }).lean();
    if (reusedRecord) {
      this.securityEvents.record(SecurityEvent.RefreshTokenReuseDetected, {
        userId: reusedRecord.userId,
        sessionId: reusedRecord.sessionId,
      });
      await this.revokeSession(reusedRecord.sessionId);
      await this.notifyOwner(reusedRecord.userId);
    }
    return null;
  }

  private async notifyOwner(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      return;
    }
    await this.mailService.send({
      to: user.email,
      subject: 'Suspicious activity: one of your sessions was terminated',
      text:
        'A sign-in token of yours was used twice, which normally means it was stolen. ' +
        'The affected session has been terminated; your other devices are unaffected. ' +
        'If this was not you, we recommend changing your password.',
    });
  }

  /**
   * Ends one device session: its tokens and the session row go together, so nothing is left that
   * could be redeemed or shown in a device list. The caller's generic 401 stays indistinguishable.
   */
  async revokeSession(sessionId: string): Promise<void> {
    await Promise.all([this.refreshTokenModel.deleteMany({ sessionId }), this.sessionsService.delete(sessionId)]);
  }

  /** "Logout everywhere": kills every device session of the user (password change, compromise response). */
  async revokeAllForUser(userId: string): Promise<void> {
    await Promise.all([this.refreshTokenModel.deleteMany({ userId }), this.sessionsService.deleteAllForUser(userId)]);
  }
}
