import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// Server-side refresh-token store: only the sha256 hash of a token is persisted, so a database
// leak exposes nothing replayable. An unconsumed record is what makes a token redeemable —
// deleting a family's records is revocation.
@Schema()
export class RefreshToken {
  @Prop({ required: true, unique: true })
  tokenHash: string;

  @Prop({ required: true })
  userId: string;

  // One family = one device session: sign-in starts a family, rotation stays inside it.
  // Reuse of a consumed token revokes the whole family (theft signal) without touching
  // the user's other sessions.
  @Prop({ required: true, index: true })
  familyId: string;

  // Consumed records are kept until their TTL, not deleted: a replayed token must be
  // distinguishable from a forged one — that is what makes reuse detectable.
  @Prop({ type: Date, default: null })
  consumedAt: Date | null;

  // TTL index (`expires: 0`): MongoDB purges the record once expiresAt passes,
  // so the store never accumulates dead tokens.
  @Prop({ required: true, type: Date, expires: 0 })
  expiresAt: Date;
}

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
