import { z } from 'zod';
import { createZodDto, requiredStringSchema } from '../../common/validation/index.js';
import { ForgotPasswordDto } from './forgotPassword.dto.js';

export class VerifyEmailDto extends createZodDto(
  z.object({
    token: requiredStringSchema('token').meta({
      description: 'Single-use verification token from the verification email',
    }),
  }),
) {}

export class ResendVerificationDto extends ForgotPasswordDto {}
