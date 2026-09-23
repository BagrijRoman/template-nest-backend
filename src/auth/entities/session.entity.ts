import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * One device session: what the user recognizes as "this phone", "my laptop at work". Refresh tokens
 * rotate inside it (`sessionId`), so the session — not the token — is what a person sees in a device
 * list and revokes. Anything that belongs to a device rather than to an account (a push
 * notification token, an analytics id) belongs on this document.
 */
@Schema({ timestamps: true })
export class Session {
  @Prop({ required: true, index: true })
  userId: string;

  // Recognition aids, both best-effort: a client may send no User-Agent, and the address is only as
  // trustworthy as TRUST_PROXY makes it. Stored to be shown back to the account owner, nothing else.
  @Prop()
  userAgent?: string;

  @Prop()
  ip?: string;

  // Moved forward on every rotation, so a stale session is visible as such in the device list.
  @Prop({ required: true, type: Date })
  lastSeenAt: Date;

  // TTL index (`expires: 0`): the session dies with its last refresh token, whose expiry it mirrors.
  @Prop({ required: true, type: Date, expires: 0 })
  expiresAt: Date;

  // Managed by Mongoose via `timestamps: true`.
  createdAt: Date;
  updatedAt: Date;
}

export type SessionDocument = HydratedDocument<Session>;
export const SessionSchema = SchemaFactory.createForClass(Session);
