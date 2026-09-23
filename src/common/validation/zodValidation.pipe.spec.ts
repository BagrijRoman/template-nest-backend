import { ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppException, ErrorCode } from '../errors/index.js';
import { createZodDto } from './zodDto.js';
import { ZodValidationPipe } from './zodValidation.pipe.js';

class SampleDto extends createZodDto(
  z.object({
    email: z.string().trim().toLowerCase().email({ error: 'email must be a valid email address' }),
    name: z.string().min(1, { error: 'name must not be empty' }),
  }),
) {}

const bodyOf = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype });

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe();

  it('returns the parsed value with normalizations applied and unknown keys stripped', () => {
    const parsed = pipe.transform({ email: '  Jane@Example.COM ', name: 'Jane', isAdmin: true }, bodyOf(SampleDto));

    expect(parsed).toEqual({ email: 'jane@example.com', name: 'Jane' });
  });

  it('throws the structured validation exception when the schema rejects the value', () => {
    expect.assertions(3);
    try {
      pipe.transform({ email: 'nope', name: '' }, bodyOf(SampleDto));
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe(ErrorCode.ValidationFailed);
      expect((error as AppException).details).toEqual([
        { field: 'email', rule: 'isEmail', message: 'email must be a valid email address' },
        { field: 'name', rule: 'isNotEmpty', message: 'name must not be empty' },
      ]);
    }
  });

  it('passes parameters that are not zod DTOs through untouched', () => {
    class PlainType {}
    const value = { anything: 'goes' };

    expect(pipe.transform(value, bodyOf(PlainType))).toBe(value);
    expect(pipe.transform('42', { type: 'param', metatype: String })).toBe('42');
    expect(pipe.transform(value, { type: 'custom' })).toBe(value);
  });
});
