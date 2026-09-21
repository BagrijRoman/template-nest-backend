import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './errorCode.js';
import type { FieldError } from './errorResponse.dto.js';

export type AppExceptionOptions = {
  /** Field-bound problems (validation, "email already taken", "wrong current password"). */
  details?: FieldError[];
  /** Extra machine-readable context for the code (e.g. `retryAfterSeconds`). */
  meta?: Record<string, unknown>;
};

/**
 * The exception every domain error is thrown as: an HTTP status plus a stable `ErrorCode`, and
 * optionally per-field details and meta. `AllExceptionsFilter` serializes it verbatim; plain Nest
 * exceptions are still accepted but get only a status-derived code.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: FieldError[];
  readonly meta?: Record<string, unknown>;

  constructor(status: HttpStatus, code: ErrorCode, message: string, options: AppExceptionOptions = {}) {
    super(message, status);
    this.name = AppException.name;
    this.code = code;
    this.details = options.details;
    this.meta = options.meta;
  }

  /** A single field-bound error, the common case for business rules tied to one input. */
  static forField(status: HttpStatus, code: ErrorCode, field: string, rule: string, message: string): AppException {
    return new AppException(status, code, message, { details: [{ field, rule, message }] });
  }
}
