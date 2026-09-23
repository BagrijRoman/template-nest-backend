import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ErrorCode } from './errorCode.js';
import { VALIDATION_FAILED_MESSAGE, validationExceptionFactory } from './validationException.factory.js';

const issuesOf = (schema: z.ZodType, input: unknown) => {
  const result = schema.safeParse(input);
  if (result.success) {
    throw new Error('expected the input to fail validation');
  }
  return result.error.issues;
};

describe('validationExceptionFactory', () => {
  it('builds a 400 VALIDATION_FAILED exception with one detail per failed rule', () => {
    const schema = z.object({
      email: z.string().email({ error: 'email must be a valid email address' }),
      password: z
        .string()
        .min(8, { error: 'password must be at least 8 characters long' })
        .regex(/\d/, { error: 'password must contain at least one digit' }),
    });

    const exception = validationExceptionFactory(issuesOf(schema, { email: 'nope', password: 'short' }));

    expect(exception.getStatus()).toBe(400);
    expect(exception.code).toBe(ErrorCode.ValidationFailed);
    expect(exception.message).toBe(VALIDATION_FAILED_MESSAGE);
    expect(exception.details).toEqual([
      { field: 'email', rule: 'isEmail', message: 'email must be a valid email address' },
      { field: 'password', rule: 'minLength', message: 'password must be at least 8 characters long' },
      { field: 'password', rule: 'matches', message: 'password must contain at least one digit' },
    ]);
  });

  it('dots nested paths, array indexes included', () => {
    const schema = z.object({
      address: z.object({ city: z.string().min(1, { error: 'address.city must not be empty' }) }),
      tags: z.array(z.string()),
    });

    const exception = validationExceptionFactory(issuesOf(schema, { address: { city: '' }, tags: ['ok', 42] }));

    expect(exception.details).toEqual([
      { field: 'address.city', rule: 'isNotEmpty', message: 'address.city must not be empty' },
      { field: 'tags.1', rule: 'isString', message: expect.stringContaining('expected string') },
    ]);
  });

  it('keeps the class-validator rule vocabulary for the common checks', () => {
    const schema = z.object({
      name: z.string().max(3),
      age: z.number().min(18),
      role: z.enum(['admin', 'user']),
      items: z.array(z.string()).min(1),
      id: z.string().uuid(),
    });

    const rules = validationExceptionFactory(
      issuesOf(schema, { name: 'toolong', age: 3, role: 'guest', items: [], id: 'x' }),
    ).details?.map(({ field, rule }) => `${field}:${rule}`);

    expect(rules).toEqual(['name:maxLength', 'age:min', 'role:isEnum', 'items:arrayMinSize', 'id:isUuid']);
  });

  it('names a custom refinement by its rule param, falling back to "custom"', () => {
    const schema = z.object({
      a: z.string().refine(() => false, { error: 'a failed', params: { rule: 'isAllowed' } }),
      b: z.string().refine(() => false, { error: 'b failed' }),
    });

    expect(validationExceptionFactory(issuesOf(schema, { a: '', b: '' })).details).toEqual([
      { field: 'a', rule: 'isAllowed', message: 'a failed' },
      { field: 'b', rule: 'custom', message: 'b failed' },
    ]);
  });
});
