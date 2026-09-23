import { z } from 'zod';
import { createZodDto, emailSchema, requiredStringSchema } from '../../common/validation/index.js';

export class SignInDto extends createZodDto(
  z.object({
    email: emailSchema,
    password: requiredStringSchema('password').meta({ example: 'Secret123' }),
  }),
) {}
