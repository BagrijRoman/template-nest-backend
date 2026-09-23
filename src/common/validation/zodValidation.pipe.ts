import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { validationExceptionFactory } from '../errors/index.js';
import { isZodDto } from './zodDto.js';

/**
 * The global pipe: any parameter typed with a `createZodDto` class is parsed through its schema —
 * unknown keys are stripped, normalizations (trim, lower-case) applied, and every failed rule
 * becomes a `{ field, rule, message }` detail. Other parameters pass through untouched.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, { metatype }: ArgumentMetadata): unknown {
    if (!isZodDto(metatype)) {
      return value;
    }
    const result = metatype.schema.safeParse(value);
    if (!result.success) {
      throw validationExceptionFactory(result.error.issues);
    }
    return result.data;
  }
}
