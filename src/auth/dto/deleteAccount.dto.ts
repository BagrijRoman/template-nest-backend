import { z } from 'zod';
import { createZodDto, requiredStringSchema } from '../../common/validation/index.js';

export class DeleteAccountDto extends createZodDto(
  z.object({
    currentPassword: requiredStringSchema('currentPassword').meta({ example: 'Secret123' }),
  }),
) {}
