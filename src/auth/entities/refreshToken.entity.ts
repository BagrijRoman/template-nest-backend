import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// Server-side refresh-token store: only the sha256 hash of a token is persisted, so a database
// leak exposes nothing replayable. A record's presence is what makes the token redeemable —
// deleting it is revocation.
@Schema()
export class RefreshToken {
  @Prop({ required: true, unique: true })
  tokenHash: string;

  @Prop({ required: true })
  userId: string;

  // TTL index (`expires: 0`): MongoDB purges the record once expiresAt passes,
  // so the store never accumulates dead tokens.
  @Prop({ required: true, type: Date, expires: 0 })
  expiresAt: Date;
}

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
