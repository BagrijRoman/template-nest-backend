import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppException } from './app.exception.js';
import { ErrorCode } from './errorCode.js';

describe('AppException', () => {
  it('is an HttpException carrying a stable code', () => {
    const exception = new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.InvalidCredentials,
      'Invalid email or password',
    );

    expect(exception).toBeInstanceOf(HttpException);
    expect(exception.getStatus()).toBe(401);
    expect(exception.code).toBe(ErrorCode.InvalidCredentials);
    expect(exception.message).toBe('Invalid email or password');
    expect(exception.details).toBeUndefined();
    expect(exception.meta).toBeUndefined();
  });

  it('builds a single field-bound error with forField', () => {
    const exception = AppException.forField(HttpStatus.CONFLICT, ErrorCode.EmailTaken, 'email', 'unique', 'Taken');

    expect(exception.getStatus()).toBe(409);
    expect(exception.details).toEqual([{ field: 'email', rule: 'unique', message: 'Taken' }]);
  });
});
