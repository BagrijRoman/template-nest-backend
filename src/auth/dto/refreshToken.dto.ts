import { z } from 'zod';
import { createZodDto, requiredStringSchema } from '../../common/validation/index.js';

export class RefreshTokenDto extends createZodDto(
  z.object({
    refreshToken: requiredStringSchema('refreshToken').meta({
      description: 'Refresh token previously issued by login or refresh',
    }),
  }),
) {}
