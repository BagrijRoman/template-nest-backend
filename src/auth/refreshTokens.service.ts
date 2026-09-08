import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RefreshToken } from './entities/index.js';
import { TokensService } from './tokens.service.js';

const MS_PER_SECOND = 1000;

// Deterministic sha256, not scrypt: a refresh token embeds a 256-bit HMAC signature, so preimage
// resistance is enough — and the store is looked up by hash, which requires determinism.
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class RefreshTokensService {
  constructor(
    @InjectModel(RefreshToken.name) private readonly refreshTokenModel: Model<RefreshToken>,
    private readonly tokensService: TokensService,
  ) {}

  /** Stores a just-issued refresh token, hashed; the record expires together with the token. */
  async persist(refreshToken: string): Promise<void> {
    const payload = await this.tokensService.verifyRefreshToken(refreshToken);
    if (!payload) {
      // Only just-issued tokens reach here, so an invalid one is a programming error, not user input.
      throw new Error('Refusing to persist an invalid refresh token');
    }

    await this.refreshTokenModel.create({
      tokenHash: hashToken(refreshToken),
      userId: payload.sub,
      expiresAt: new Date(payload.exp * MS_PER_SECOND),
    });
  }

  /**
   * Redeems a refresh token: verifies it and atomically removes its record, so a token can never
   * be used twice — rotation and logout share this. Returns the owning user id, or null when the
   * token is invalid, expired, already used, or revoked.
   */
  async consume(refreshToken: string): Promise<string | null> {
    const payload = await this.tokensService.verifyRefreshToken(refreshToken);
    if (!payload) {
      return null;
    }

    const record = await this.refreshTokenModel.findOneAndDelete({ tokenHash: hashToken(refreshToken) }).lean();
    return record ? payload.sub : null;
  }
}
