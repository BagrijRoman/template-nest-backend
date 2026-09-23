import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ActionToken, ActionTokenType } from './entities/index.js';

const TOKEN_BYTES = 32;

// Deterministic sha256, not scrypt: the token is 32 random bytes, so preimage resistance is enough —
// and the store is looked up by hash, which requires determinism.
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * The one store behind every "we mailed you a link" flow (password reset, email verification, and
 * whatever comes next — an invite, a magic link): they differ only in the action they authorize and
 * how long it stays valid, so they share this service instead of a collection each.
 */
@Injectable()
export class ActionTokensService {
  constructor(@InjectModel(ActionToken.name) private readonly actionTokenModel: Model<ActionToken>) {}

  /**
   * Returns the raw token to mail out; only its hash is stored. Any previous token for the same
   * user and action is dropped first, so exactly one is redeemable at a time.
   */
  async issue(type: ActionTokenType, userId: string, ttlMs: number): Promise<string> {
    await this.actionTokenModel.deleteMany({ userId, type });

    const token = randomBytes(TOKEN_BYTES).toString('hex');
    await this.actionTokenModel.create({
      tokenHash: hashToken(token),
      type,
      userId,
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return token;
  }

  /**
   * Redeems a token for one action: find-and-delete is atomic, so it works exactly once. Returns the
   * owner, or null when the token is unknown, expired, already used — or issued for another action.
   */
  async redeem(type: ActionTokenType, token: string): Promise<string | null> {
    const record = await this.actionTokenModel.findOneAndDelete({ tokenHash: hashToken(token), type }).lean();
    return record && record.expiresAt > new Date() ? record.userId : null;
  }

  /** Drops every pending token of a deleted account. */
  async deleteForUser(userId: string): Promise<void> {
    await this.actionTokenModel.deleteMany({ userId });
  }
}
