import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * The single source of password-strength rules (sign-up, change password, future reset flow).
 * `field` names the property in validation messages, e.g. "newPassword must contain …".
 */
export const IsStrongPassword = (field: string) =>
  applyDecorators(
    IsString(),
    MinLength(PASSWORD_MIN_LENGTH, { message: `${field} must be at least ${PASSWORD_MIN_LENGTH} characters long` }),
    MaxLength(PASSWORD_MAX_LENGTH),
    Matches(/[a-z]/, { message: `${field} must contain at least one lowercase letter` }),
    Matches(/[A-Z]/, { message: `${field} must contain at least one uppercase letter` }),
    Matches(/\d/, { message: `${field} must contain at least one digit` }),
  );
