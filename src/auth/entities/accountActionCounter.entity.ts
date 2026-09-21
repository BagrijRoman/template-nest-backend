import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// Per-account action counters (e.g. "verification-email:<userId>"): one document per
// action+account within a fixed window, TTL-purged afterwards.
@Schema()
export class AccountActionCounter {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ required: true, default: 0 })
  count: number;

  // Fixed window: set when the first request of the window creates the document; the TTL
  // index (`expires: 0`) purges it, and the code treats an expired document as absent.
  @Prop({ required: true, type: Date, expires: 0 })
  expiresAt: Date;
}

export type AccountActionCounterDocument = HydratedDocument<AccountActionCounter>;
export const AccountActionCounterSchema = SchemaFactory.createForClass(AccountActionCounter);
