import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum UserRole {
  User = 'user',
  Admin = 'admin',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  // Verified via the email-verification flow. The template deliberately still issues tokens at
  // sign-up; gating features on this flag is a per-product decision.
  @Prop({ required: true, default: false })
  emailVerified: boolean;

  // Coarse authorization level checked by RolesGuard on @Roles() routes; everyone signs up as a plain user.
  @Prop({ type: String, required: true, enum: Object.values(UserRole), default: UserRole.User })
  role: UserRole;

  // Access tokens issued before this moment are refused by JwtAuthGuard: it is how a password
  // change takes effect at once instead of when the last stolen access token expires. Unset on
  // accounts that never revoked anything.
  @Prop({ type: Date, default: null })
  sessionsValidFrom: Date | null;

  // Managed by Mongoose via `timestamps: true`.
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

// The shape that leaves UsersService and reaches API responses: the entity holds no secret (hashes
// live in `credentials`), so this is the entity plus `id`, the string form of `_id`, minus the
// session cutoff, which is authentication bookkeeping and no business of a client.
export type UserProfile = Omit<User, 'sessionsValidFrom'> & { id: string };
