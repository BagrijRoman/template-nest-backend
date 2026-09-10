import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// Email-verification tokens, stored only as sha256 hashes (same reasoning as refresh and reset
// tokens). One active token per user; redeemed by an atomic find-and-delete — exactly one use.
@Schema()
export class EmailVerificationToken {
  @Prop({ required: true, unique: true })
  tokenHash: string;

  @Prop({ required: true, index: true })
  userId: string;

  // TTL index (`expires: 0`); the code still checks expiry itself — the TTL monitor lags.
  @Prop({ required: true, type: Date, expires: 0 })
  expiresAt: Date;
}

export type EmailVerificationTokenDocument = HydratedDocument<EmailVerificationToken>;
export const EmailVerificationTokenSchema = SchemaFactory.createForClass(EmailVerificationToken);
