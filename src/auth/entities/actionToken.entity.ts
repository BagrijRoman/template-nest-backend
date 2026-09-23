import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** What a single-use token entitles its holder to do. One row per flow that mails out a token. */
export enum ActionTokenType {
  PasswordReset = 'password-reset',
  EmailVerification = 'email-verification',
}

/**
 * Single-use tokens mailed to a user, stored only as sha256 hashes (same reasoning as refresh
 * tokens: a database leak must expose nothing redeemable). One active token per user and action;
 * redeemed by an atomic find-and-delete, so a token works exactly once.
 */
@Schema()
export class ActionToken {
  @Prop({ required: true, unique: true })
  tokenHash: string;

  // Explicit `type`: the property is itself named `type`, which Mongoose would otherwise misread.
  // Matched on redemption as well as on lookup, so a token issued for one action can never be
  // redeemed as another.
  @Prop({ type: String, required: true, enum: Object.values(ActionTokenType) })
  type: ActionTokenType;

  @Prop({ required: true })
  userId: string;

  // TTL index (`expires: 0`): MongoDB purges the record once expiresAt passes; the code still
  // checks expiry itself — the TTL monitor lags up to a minute.
  @Prop({ required: true, type: Date, expires: 0 })
  expiresAt: Date;
}

export type ActionTokenDocument = HydratedDocument<ActionToken>;
export const ActionTokenSchema = SchemaFactory.createForClass(ActionToken);
ActionTokenSchema.index({ userId: 1, type: 1 });
