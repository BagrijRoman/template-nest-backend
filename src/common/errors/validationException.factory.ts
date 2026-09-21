import { HttpStatus, ValidationError } from '@nestjs/common';
import { AppException } from './app.exception.js';
import { ErrorCode } from './errorCode.js';
import type { FieldError } from './errorResponse.dto.js';

export const VALIDATION_FAILED_MESSAGE = 'Validation failed';

/** Flattens class-validator's tree (nested DTOs included) into one entry per failed rule. */
const flatten = (errors: ValidationError[], parentPath = ''): FieldError[] =>
  errors.flatMap((error) => {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own = Object.entries(error.constraints ?? {}).map(([rule, message]) => ({ field, rule, message }));
    return [...own, ...flatten(error.children ?? [], field)];
  });

/** Plugged into the global ValidationPipe so validation errors carry structured, per-field details. */
export const validationExceptionFactory = (errors: ValidationError[]): AppException =>
  new AppException(HttpStatus.BAD_REQUEST, ErrorCode.ValidationFailed, VALIDATION_FAILED_MESSAGE, {
    details: flatten(errors),
  });
