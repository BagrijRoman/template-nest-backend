import { ValidationError } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ErrorCode } from './errorCode.js';
import { VALIDATION_FAILED_MESSAGE, validationExceptionFactory } from './validationException.factory.js';

describe('validationExceptionFactory', () => {
  it('flattens every failed rule, nested properties included, into field errors', () => {
    const errors: ValidationError[] = [
      {
        property: 'email',
        constraints: { isEmail: 'email must be a valid email address' },
      },
      {
        property: 'password',
        constraints: {
          minLength: 'password must be at least 8 characters long',
          matches: 'password must contain at least one digit',
        },
      },
      {
        property: 'address',
        children: [{ property: 'city', constraints: { isNotEmpty: 'address.city must not be empty' } }],
      },
    ];

    const exception = validationExceptionFactory(errors);

    expect(exception.getStatus()).toBe(400);
    expect(exception.code).toBe(ErrorCode.ValidationFailed);
    expect(exception.message).toBe(VALIDATION_FAILED_MESSAGE);
    expect(exception.details).toEqual([
      { field: 'email', rule: 'isEmail', message: 'email must be a valid email address' },
      { field: 'password', rule: 'minLength', message: 'password must be at least 8 characters long' },
      { field: 'password', rule: 'matches', message: 'password must contain at least one digit' },
      { field: 'address.city', rule: 'isNotEmpty', message: 'address.city must not be empty' },
    ]);
  });
});
