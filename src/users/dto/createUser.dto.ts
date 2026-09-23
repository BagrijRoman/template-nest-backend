import { z } from 'zod';
import { createZodDto, emailSchema, nameSchema, passwordSchema } from '../../common/validation/index.js';

export class CreateUserDto extends createZodDto(
  z.object({
    email: emailSchema,
    firstName: nameSchema('firstName').meta({ example: 'Jane' }),
    lastName: nameSchema('lastName').meta({ example: 'Doe' }),
    password: passwordSchema('password'),
  }),
) {}
