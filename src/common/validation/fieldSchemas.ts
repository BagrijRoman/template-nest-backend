import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const NAME_MAX_LENGTH = 100;
// RFC 5321 limits; zod's email format checks the shape only, not the length.
const EMAIL_MAX_LENGTH = 254;
const EMAIL_LOCAL_PART_MAX_LENGTH = 64;
const INVALID_EMAIL_MESSAGE = 'email must be a valid email address';

const tooLongMessage = (field: string, max: number) => `${field} must be shorter than or equal to ${max} characters`;

// Zod's default messages name types, not fields ("expected string, received undefined"); the error
// contract phrases every message as "<field> must …", so the field name is threaded through here.
// A missing field reads "must not be empty", as the previous validator phrased it.
const stringField = (field: string) =>
  z.string({
    error: (issue) => (issue.input === undefined ? `${field} must not be empty` : `${field} must be a string`),
  });

const hasRfcCompliantLength = (email: string): boolean =>
  email.length <= EMAIL_MAX_LENGTH && email.indexOf('@') <= EMAIL_LOCAL_PART_MAX_LENGTH;

/** A non-empty string kept verbatim: tokens, the sign-in password, the current password. */
export const requiredStringSchema = (field: string) =>
  stringField(field).min(1, { error: `${field} must not be empty` });

/** A trimmed, length-capped display name (first / last name). */
export const nameSchema = (field: string) =>
  stringField(field)
    .trim()
    .min(1, { error: `${field} must not be empty` })
    .max(NAME_MAX_LENGTH, { error: tooLongMessage(field, NAME_MAX_LENGTH) });

/** A normalized (trimmed, lower-cased) email: the shape sign-up, sign-in and the email flows all look up. */
export const emailSchema = stringField('email')
  .trim()
  .toLowerCase()
  .email({ error: INVALID_EMAIL_MESSAGE })
  .refine(hasRfcCompliantLength, { error: INVALID_EMAIL_MESSAGE, params: { rule: 'isEmail' } })
  .meta({ example: 'jane@example.com' });

/**
 * The single source of password-strength rules (sign-up, change password, reset password).
 * `field` names the property in validation messages, e.g. "newPassword must contain …".
 */
export const passwordSchema = (field: string) =>
  stringField(field)
    .min(PASSWORD_MIN_LENGTH, { error: `${field} must be at least ${PASSWORD_MIN_LENGTH} characters long` })
    .max(PASSWORD_MAX_LENGTH, { error: tooLongMessage(field, PASSWORD_MAX_LENGTH) })
    .regex(/[a-z]/, { error: `${field} must contain at least one lowercase letter` })
    .regex(/[A-Z]/, { error: `${field} must contain at least one uppercase letter` })
    .regex(/\d/, { error: `${field} must contain at least one digit` })
    .meta({
      description: 'Must contain at least one lowercase letter, one uppercase letter and one digit',
      example: 'Secret123',
    });
