import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum CredentialType {
  Password = 'password',
}

// Secret material lives here, apart from `users`: a user query can never return a hash by
// accident, and other credential kinds (OAuth providers, passkeys, TOTP) get a row each later.
@Schema({ timestamps: true })
export class Credential {
  @Prop({ required: true })
  userId: string;

  // Explicit `type`: the property is itself named `type`, which Mongoose would otherwise misread.
  @Prop({ type: String, required: true, enum: Object.values(CredentialType) })
  type: CredentialType;

  // For passwords: the salted scrypt hash from password.util.ts. Never the secret itself.
  @Prop({ required: true })
  secretHash: string;

  // Managed by Mongoose via `timestamps: true`.
  createdAt: Date;
  updatedAt: Date;
}

export type CredentialDocument = HydratedDocument<Credential>;
export const CredentialSchema = SchemaFactory.createForClass(Credential);
// One credential of each type per user.
CredentialSchema.index({ userId: 1, type: 1 }, { unique: true });
