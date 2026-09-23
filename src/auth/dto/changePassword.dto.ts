import { z } from 'zod';
import { createZodDto, passwordSchema, requiredStringSchema } from '../../common/validation/index.js';

export class ChangePasswordDto extends createZodDto(
  z.object({
    currentPassword: requiredStringSchema('currentPassword').meta({ example: 'OldSecret123' }),
    newPassword: passwordSchema('newPassword').meta({ example: 'NewSecret123' }),
  }),
) {}
