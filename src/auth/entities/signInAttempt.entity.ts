import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// Failed sign-in counter per email — including emails that belong to no account: if only real
// accounts could lock, the lockout itself would reveal account existence.
@Schema()
export class SignInAttempt {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true, default: 0 })
  failedCount: number;

  // Pushed forward on every failure (sliding window) and TTL-purged (`expires: 0`) afterwards.
  // Mongo's TTL monitor lags up to a minute, so the code treats an expired record as absent.
  @Prop({ required: true, type: Date, expires: 0 })
  expiresAt: Date;
}

export type SignInAttemptDocument = HydratedDocument<SignInAttempt>;
export const SignInAttemptSchema = SchemaFactory.createForClass(SignInAttempt);
