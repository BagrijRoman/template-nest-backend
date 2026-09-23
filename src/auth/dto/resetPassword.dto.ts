import { z } from 'zod';
import { createZodDto, passwordSchema, requiredStringSchema } from '../../common/validation/index.js';

export class ResetPasswordDto extends createZodDto(
  z.object({
    token: requiredStringSchema('token').meta({ description: 'Single-use reset token from the password-reset email' }),
    newPassword: passwordSchema('newPassword').meta({ example: 'NewSecret123' }),
  }),
) {}
