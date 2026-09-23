import { createZodDto } from '../../common/validation/index.js';
import { CreateUserDto } from './createUser.dto.js';

// Derived from the sign-up schema, so the name rules have one source. Only the fields a caller may
// change on their own are here: the email is a credential-adjacent change (it has to be re-verified)
// and the role is an operator action.
export class UpdateProfileDto extends createZodDto(
  CreateUserDto.schema
    .pick({ firstName: true, lastName: true })
    .partial()
    .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
      error: 'at least one of firstName, lastName must be provided',
      params: { rule: 'notEmptyPatch' },
    }),
) {}
