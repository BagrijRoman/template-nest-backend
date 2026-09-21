import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// Password-reset tokens, stored only as sha256 hashes (same reasoning as refresh tokens: a
// database leak must expose nothing redeemable). One active token per user; redeemed by an
// atomic find-and-delete, so a token works exactly once.
@Schema()
export class PasswordResetToken {
  @Prop({ required: true, unique: true })
  tokenHash: string;

  @Prop({ required: true, index: true })
  userId: string;

  // TTL index (`expires: 0`): MongoDB purges the record once expiresAt passes; the code still
  // checks expiry itself — the TTL monitor lags up to a minute.
  @Prop({ required: true, type: Date, expires: 0 })
  expiresAt: Date;
}

export type PasswordResetTokenDocument = HydratedDocument<PasswordResetToken>;
export const PasswordResetTokenSchema = SchemaFactory.createForClass(PasswordResetToken);
