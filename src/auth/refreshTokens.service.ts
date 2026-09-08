import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RefreshToken } from './entities/index.js';
import { TokensService } from './tokens.service.js';

const MS_PER_SECOND = 1000;

// Deterministic sha256, not scrypt: a refresh token embeds a 256-bit HMAC signature, so preimage
// resistance is enough — and the store is looked up by hash, which requires determinism.
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export type ConsumedRefreshToken = { userId: string; familyId: string };

@Injectable()
export class RefreshTokensService {
  private readonly logger = new Logger(RefreshTokensService.name);

  constructor(
    @InjectModel(RefreshToken.name) private readonly refreshTokenModel: Model<RefreshToken>,
    private readonly tokensService: TokensService,
  ) {}

  /** Stores a just-issued refresh token, hashed, inside the given family; the record expires with the token. */
  async persist(refreshToken: string, familyId: string): Promise<void> {
    const payload = await this.tokensService.verifyRefreshToken(refreshToken);
    if (!payload) {
      // Only just-issued tokens reach here, so an invalid one is a programming error, not user input.
      throw new Error('Refusing to persist an invalid refresh token');
    }

    await this.refreshTokenModel.create({
      tokenHash: hashToken(refreshToken),
      userId: payload.sub,
      familyId,
      consumedAt: null,
      expiresAt: new Date(payload.exp * MS_PER_SECOND),
    });
  }

  /**
   * Redeems a refresh token: verifies it and atomically marks its record consumed, so a token can
   * never be redeemed twice — rotation and logout share this. Returns the owner and family, or
   * null when the token is invalid, expired, already used, or revoked.
   *
   * A consumed token showing up again is proof of theft (either the thief or the victim holds a
   * copy that already rotated), so the whole family is revoked — the strict stance: a legitimate
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
      return { userId: record.userId, familyId: record.familyId };
    }

    const reusedRecord = await this.refreshTokenModel.findOne({ tokenHash }).lean();
    if (reusedRecord) {
      this.logger.warn(
        `Refresh token reuse detected for user ${reusedRecord.userId} — revoking token family ${reusedRecord.familyId}`,
      );
      await this.revokeFamily(reusedRecord.familyId);
    }
    return null;
  }

  /** Revokes every token of one device session; the caller's generic 401 stays indistinguishable. */
  private async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokenModel.deleteMany({ familyId });
  }

  /** "Logout everywhere": kills every device session of the user (password change, compromise response). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokenModel.deleteMany({ userId });
  }
}
