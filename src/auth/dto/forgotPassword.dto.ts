import { z } from 'zod';
import { createZodDto, emailSchema } from '../../common/validation/index.js';

export class ForgotPasswordDto extends createZodDto(z.object({ email: emailSchema })) {}
